# cpl_upfans_tsid_dssm_gate_dw — CPL/涨粉创意优选双塔模型

> 项目定位：微博广告 CPL（按转化付费）/ 涨粉业务的**创意优选双塔模型**（DSSM + gate）。离线训练用户塔与广告（创意）塔，**用户塔部署到 predictor 在线实时算向量，广告塔离线批量算出创意向量写入 Redis**，线上创意优选服务（ad_creative）用 `sigmoid(cosine × 10 + user_bias)` 对每个候选创意打分选优。
> 工作区路径：`/data0/huizhu1/retailer/online/creative/workspace/cpl_upfans_tsid_dssm_gate_dw`
> 生成日期：2026-10-28

---

## 目录

1. [总体架构：一个模型两个视角](#1-总体架构一个模型两个视角)
2. [模型结构：dssm_gate](#2-模型结构dssm_gate)
3. [特征体系](#3-特征体系)
4. [训练流程（run_incr_model_window.sh）](#4-训练流程run_incr_model_windowsh)
5. [模型更新流程（upload_vec.sh）](#5-模型更新流程upload_vecsh)
6. [AB 实验与多版本向量机制](#6-ab-实验与多版本向量机制)
7. [关键配置速查](#7-关键配置速查)

---

## 1. 总体架构：一个模型两个视角

```
                    ┌─────────────────────────────────────────┐
                    │  DSSM-Gate 模型（一份权重，两个导出视角）   │
                    │                                         │
 样本特征 ──user──► │  User-tower  (LR+FM+DNN → 128→64→8)  ──► user_embedding (8维)
                    │  User-bias   (用户特征 → 128→1)       ──► user_bias (标量)
 样本特征 ──ad────► │  Ad-tower    (LR+FM+DNN+SceneGate → 8) ──► ad_embedding (8维)
                    │                                         │
                    │  训练: logits = cosine(u,a)×10 + bias    │
                    │        loss   = sigmoid_cross_entropy    │
                    └─────────────────────────────────────────┘
                          │                          │
              导出视角①(base/)              导出视角②(conf_ad/, base_ad/)
              output=User-tower+bias        output=Ad-tower
                          │                          │
                          ▼                          ▼
                 content_service → predictor    generate_ad_vec.sh
                 （在线实时算用户向量）          （离线批量算创意向量）
                          │                          │
                          ▼                          ▼
                 user_vec + bias +           Redis: {tsid}_{版本}_{时间戳}
                 model_timestamp             → 8维向量（多版本共存）
                          │                          │
                          └──────────┬───────────────┘
                                     ▼
                       ad_creative 服务在线打分:
                       ctcvr = sigmoid(cosine(u,a)×10 + user_bias)
                       叠加 rt/model 分数后选出最优创意
```

**为什么一份权重两个视角**：训练时 user/ad 两塔在一个计算图里联合训练（cosine 是联合信号）；上线时两塔的使用方式完全不同——用户向量每请求实时算（predictor 加载 User-tower 导出），创意向量离线批量算一次缓存（Ad-tower 导出跑批量推理）。`base/` 与 `base_ad/` 两份 `tf_config.json` 的 `output_tensor_names` 分别指向 `User-tower/...` 和 `Ad-tower/...`，`model_config.json` 的模型名尾缀区分（`...dssm_gate_dw_huizhu1` vs `...dssm_ad_dw_huizhu1`）。

**样本数据由上游共享工作区生产**（`share_data_path=viewfs://c9/user_ext/ads_rank/model/zoo/model_id=d_m_21527`），本项目只做训练与向量生产。

---

## 2. 模型结构：dssm_gate

代码：`model_train/deeprank/models/dssm_gate.py`（注册名 `dssm_gate`），配置 `conf/model.yaml`（用户视角）与 `conf_ad/model.yaml`（广告视角，结构参数完全相同）。

### 2.1 三塔结构

```yaml
user_tower_layers: [128, 64, 8]    # 用户塔：输出 8 维
ad_tower_layers:   [128, 128, 128] # 广告塔：输出 128 维
user_bias_layers:  [128, 1]        # bias 塔：输出 1 维标量
tower_embedding_size: 8            # 最终向量维度 8
```

**每个塔的内部结构**（`tower_net` / `ad_tower_net`）是 **LR 一阶 + FM 二阶 + DNN 的 Wide&Deep 变体**：

```
slot embedding (fm_v, 8维共享)
  ├─ First-order: fm_w 一阶权重 (wide slots)
  ├─ Second-order: 0.5·(Σemb)² − Σemb²   (FM 二阶交叉)
  └─ Deep-part: MLP [128,...] × batch_norm × relu × dropout
        ▼
y_merge = concat[y_lr, y_fm, y_dnn]
        ▼
y_embedding = FC(y_merge → 8维, 无激活)      # 塔输出
```

### 2.2 Scene-gate：广告塔独有

广告塔的 DNN 每层多一个**场景门控**（`Scene-gate` scope）：

```python
gate = FC(scene_inputs, 1, 无激活)          # scene_inputs = auxiliary_slot (20,21,22) 的 embedding
deep_inputs = relu(deep_inputs) * sigmoid(gate)   # 逐层门控
deep_inputs += last_deep_inputs                  # 残差连接
```

`auxiliary_slot = [20, 21, 22]`（推广目标 / 优化目标 / deliver_id）——**不同推广场景下创意 embedding 的生成路径不同**，这是"gate"名称的来源之一（另一个 gate 是下述 bias 门）。

### 2.3 打分与损失

```python
cosine = dot(u,a) / (|u|·|a| + 1e-8)        # 分母加 1e-8 防零
logits = cosine × 10 + user_bias            # w=10 硬编码在模型代码里
prod   = sigmoid(logits)
loss   = sigmoid_cross_entropy (+ L2 正则 1e-5)
```

**bias 塔（gate）的作用**：`user_bias_net` 单独从用户特征学一个标量，吸收"用户整体转化倾向"（高活用户对什么都点），与向量匹配度解耦——防止用户活性信号污染兴趣匹配信号。

注意与线上打分的对应关系：线上 `CalculateVector`（ad_creative）是 `sigmoid(cosine×w + bias)`，**同一个公式**，w 也一致（线上 cosine_weight 配置为 10 时）。

### 2.4 优化器与训练参数

```yaml
Adagrad: lr=0.01, initial_accumulator_value=1e-4
batch_size=4096, max_epochs=1 (增量), save_checkpoint_step=5000, keep_checkpoint_num=3
ps_num: 1（yaml）/ 10（train.config，命令行覆盖）
```

`predict_keys: [ad_embedding, user_embedding, user_bias, cosine]`——推理时可导出全部中间量（向量生产与离线分析都靠它）。

---

## 3. 特征体系

特征清单在 `conf/feature_list.conf`（71 个，全量 schema 由 `conf/feature_list_user.conf` 47 个用户特征 + `conf_ad/feature_list.conf` 24 个广告特征组成），xfea 配置 `conf/xfea.conf`（用户侧）/ `conf_ad/xfea.conf`（广告侧）。

### 3.1 用户侧特征（slot 101-320）

| 大类 | 示例 slot | 内容 |
|---|---|---|
| 人口属性 | 101-113 | gender、age（分桶）、地域、平台、OS/品牌、时段 |
| 行为序列（multi-hot） | 103, 130-139, 308-313 | life_state、follow_list、点击/转化的 custuid/deliverid/appid 列表（上限 10-20 个） |
| 实时行为统计 | 300, 301 | 会话内 pv/曝光/互动组合（S_spref_pvclk） |
| 历史行为统计 | 302-307, 314-320 | clk/conv 的 adid、custuid、industryid 列表 + uctr/upv/uclk 计数分桶 |

### 3.2 广告侧特征（slot 20-46）

| 大类 | 示例 slot | 内容 |
|---|---|---|
| 计划身份 | 20-27 | promotion/optimization objective、deliver_id、cust_uid、industry、campaign、feed_id |
| 创意样式 | 28, 29 | creative_style、style_code |
| 素材语义（tsid） | 32-39 | 图/视频/文案的 md5 及 origin md5 |
| 素材内容 | 41-45 | tsid_feature_code 序列、adid_tag、l2/l3 标签序列 |
| 其他 | 42, 46 | 文本链接数分桶、tsid_target_code |

### 3.3 hash 规则

- `feature_default_is_hash=true`，签名范围 `[1, 5e7)`，与 `feature_size=1000000`（tower 内部 embedding 表规模）配合；`use_embedding_table=false` 时直接建 `fm_w [1e6]` / `fm_v [1e6, 8]` 变量表
- 加工类型：`S_direct`（直出）、`S_discret`（数值分桶，支持 -1 哨兵）、`S_multi`（多字段交叉）、`S_split_field`（多值拆分）

### 3.4 样本定义（hive_sql/cpl_upfans_tsid_dssm_hive.sh）

两条流量 union（小时表，`distribute by rand()` 打散）：

- **CPL 样本**：`fdm_wb_ad_data_sample_cpl_offline_hour`，`promotion_objective_code ∈ (88030003, 88030008, 88030004, 88030006)`，剔除 CPM/特定 ps_id/热门推荐访客/免费赠送等
- **涨粉样本**：`fdm_wb_ad_data_sample_fans_offline_hour`，`promotion_objective=88030002（涨粉）× optimization_objective=86002003`，label = `if(follow_bhv_atten_cnt > 0, 1, 0)`（是否关注）
- 通用过滤：`c2s_imp_cnt>0`、`error_code='0'`、`feature_joinflag='1'`、`is_free_sale<>'1'`
- logid：`pvid_uid_custuid_deliverid_feedid_tsiduniqueid_po_oo`（用于样本拼接与向量去重）

---

## 4. 训练流程（run_incr_model_window.sh）

入口：`run.sh` → `data/run_train_loop/run_incr_model_window.sh conf/model_data_pipeline.conf`，常驻 `while [1]` 循环，每轮约 300s 轮询。

```
┌──────────────────── 每轮循环 ────────────────────┐
│                                                   │
│ 1. get_incr_data: 选增量基座 + 数据窗口            │
│ 2. gen tfrecord: 样本 → TFRecord                  │
│ 3. run_model_train.sh: 增量训练 1 epoch            │
│ 4. run_model_infer: 下一小时数据评估 AUC            │
│ 5. 闸门: auc>0.80 且 gap∈[-0.56,0.56]             │
│    ├─ 通过 → generate_ad_vec.sh(向量生产)          │
│    │        + touch hour.model.done.<ts> → exit   │
│    └─ 不通过 → 数据不丢，滚动累计进入下一轮          │
└───────────────────────────────────────────────────┘
```

### 4.1 增量基座选择（get_incr_data，第 92-200 行）

四分支决策（核心机制）：

| 状况 | 行为 |
|---|---|
| 无 incr 模型、无 batch 模型 | return 1，sleep 300 等待 |
| 无 incr 模型、有 batch 模型 | **以 batch 模型为基座**（is_batch_update=1），回补 batch 日期之后的所有天级数据重训 |
| 有 incr 模型、无 batch | 上一 incr 模型直接续训 |
| 两者都有 | 若 incr 的 batch 基座日期 < 最新 batch 模型日期 → **切换到新 batch 基座**并回补数据；否则 incr 续训 |

数据窗口：`incr_mode=hour`、`incr_window_hour_num=1`——每轮吃 1 个小时分片；数据源优先 `share_data_path`（上游共享工作区），落到 `instance_inpath`（多个小时分片逗号拼接）。

**为什么有 batch 兜底**：增量链如果挂了几天（机器故障/数据断供），继续在旧增量上训会与全量分布越漂越远；batch 模型（天级全量重训）作为"定期校准锚点"，增量落后时自动切过去并回补数据，保证增量模型不超过一个 batch 周期的漂移。

### 4.2 样本转 TFRecord

`run_tfrecord_cpl_ctr_sampling.sh`（hadoop streaming，map 100 / reduce 30）：

- **mapper**（`tfrecord_mapper_cpl_ctr_sampling.py`）：logid 解析、黑名单过滤、**按 appid 的负采样**（label=0 且 `neg_rate<1` 时按采样率丢弃，采样率由 `sampled_adid.py` 两阶段统计产出）、随机 shuffle key
- **reducer**：按 feature_list.conf 解析特征、hash 进 slot、写 TFRecord

### 4.3 训练

`run_model_train.sh <train_data> <train_model> <ins_num> <model.yaml> <restore_dir>`：

- `deeprank/main.py` 读 model.yaml，从 `restore_dir`（上一轮模型 checkpoint）restore 后增量训练 1 epoch
- 步数 = `instance_num // 4096`，基于上一模型 global_step 续跑
- checkpoint 每 5000 步存一次，保留 3 份；训练完 `export_savedmodel` 到 `serving_matrix`

### 4.4 评估与闸门

- 在**下一小时**共享数据上跑 `run_model_infer_v1.sh`（auc 模式），hadoop streaming 推理 + 本地 reduce，产出 `Auc / Logloss / gap`
- 闸门（`conf/evaluate_metric_value.config`）：`auc_min=0.80`、`gap ∈ [-0.56, 0.56]`（gap 是预估 ctr 与真实 ctr 的相对偏差，容忍度比 cpl_ctr 精排宽——双塔模型只要排序能力可用即可，绝对校准靠线上 bias 修正）
- **通过**：触发向量生产（`generate_ad_vec.sh`）+ `touch hour.model.done.<ts>` 标记为下轮基座 + exit 0 结束本轮
- **不通过**：不标记 done，`get_incr_data` 下轮会把这批数据继续累计进训练（脏数据也会被滚动重训稀释，不丢数据）
- 注意区分两个评估文件：`log/{ts}-{next_ts}.evaluate.test` 是 AUC 闸门用的；`*.evaluate.dssm_infer` 是向量批量推理的中间产物

---

## 5. 模型更新流程（upload_vec.sh）

`workspace/upload_vec.sh upload_vec.conf` 是**向量与模型的上线总驱动**（独立于训练循环，cron 定时触发），配置 `upload_vec.conf`：

```
model_version_list="cpl_upfans_tsid_dssm_gate_dw cpl_upfans_tsid_dssm_v2"
valid_version_code="v4,v2,v0"
```

即一个脚本同时维护两个模型版本（gate_dw 主链 + v2 对比链）的上线。

```
┌──────────── upload_fn(每个 model_version) ─────────────┐
│                                                         │
│ 1. check_latest_model_fn:                                │
│    最新 hour.model.done 时间戳 <= 已上线向量时间戳?         │
│    是 → 跳过（已最新）                                    │
│                                                         │
│ 2. update_online_vec_file: 创意向量多版本合并 → Redis      │
│    (失败重试 1 次，防抖动)                                 │
│                                                         │
│ 3. upload_model_fn: 用户塔模型上线                        │
│    (失败重试 3 次)                                        │
│                                                         │
│ 4. delete_sample_vec_fn: 清理 168 小时前的历史向量文件      │
└─────────────────────────────────────────────────────────┘
```

### 5.1 创意向量生产与多版本合并（update_online_vec_file）

这是整个上线流程最精细的一步，分四段：

**① 从推理结果表抽取新向量**

```sql
select logid, ad_vec, sum(pv) as pv
from ${sample_vec_table}            -- dssm_table_cpl_upfans_tsid_dssm_gate_v2
where dt='${model_date}' ...
group by logid, ad_vec
```

同一 tsid 多条推理结果时，后面按 **pv 最大**取代表（主流形态的向量）。行数 < 1000 判定异常终止（数据量保护）。

**② 多版本时间戳合并（map_input_timestamp.py 的 `map_ad_vec_version_timestamp`）**

线上向量文件格式：`tsid | v4_时间戳:向量;v2_时间戳:向量;v0_时间戳:向量;...`。合并规则：

1. 读线上已有文件，只保留 `valid_version_code`（v4,v2,v0）内的版本
2. 每版本维护 2 个时间戳（滑动双小时窗），新合并时**删掉本版本最旧时间戳**（`del_timestamp`），合入新时间戳的向量
3. **v2 链路特殊处理**：同时为 v0 写一份**全零向量**（`zero_new_code_ts`），删掉旧的全零——这就是 AB 实验里 v0 向量全零的来源：**v0 是刻意维护的"空基线"**，供消融实验对照
4. 产出 `updated_ad_vec_file`

**③ 体积护栏（三道）**

- 行数 < 1000 或 ≥ 5,000,000 → 失败
- 与线上文件行数差异 > 60%（MAX_DIFF_RATE=0.6）→ 失败（防止向量大面积丢失）
- 文件字节数差异 > 60% → 失败

**④ 写 Redis + 归档**

- `gen_redis_file.py`：向量文件转 Redis 格式（key list 行 `ocpx_tsid_list_cpl_upfans` + 每 tsid 一行，向量切 20 片分片写）
- `redis_data_loader`（每次从 nexus 重新下载）：写 Redis 库 `ocpx_strategy` 表 `creative_ad_vector_cpl_upfans`
- 线上文件归档回 HDFS：`sample_vec_path/online_ad_vec`（滚动全量）+ `dssm_${version}_${date}`（当期快照）
- 历史向量文件只保留最近 168 个（一周）

### 5.2 用户塔模型上线（upload_model_fn）

```
1. upload_ad_model.sh: 广告塔模型目录处理（等待 _SUCCESS_B 标记）
2. sample_make.sh: 生成一致性验证样本
   （sed 改写 base/model_config.json 的 samples_time + tf_config.json 的 model_timestamp）
3. run.sh (upload/run.sh): 模型推送 —— content_service 链路
   → 一致性验证（1e-6）→ predictor /load_and_register 热加载
4. touch _SUCCESS_C: 上线完成标记
```

**关键联动**：`model_timestamp` 写进 `tf_config.json` 随模型上线，predictor 返回用户向量时携带该时间戳；线上查创意向量时用 `{tsid}_{版本}_{model_timestamp}` 组 key——**保证用户塔和创意塔严格同时间戳配对**，这和多版本合并里维护的双时间戳窗口（覆盖 predictor 尚未切换的过渡期）是一套机制的两端。

---

## 6. AB 实验与多版本向量机制

`ab_conf/{base,exp}/` 三配置项控制线上行为（经 alchemy 平台下发）：

| 配置 | 作用 |
|---|---|
| `cplfans_user_vec_opt` | predictor 调用参数（模型名、超时 20ms、负载均衡），base/exp 相同 |
| `cplfans_user_vec_version` | **核心开关**：读哪代创意向量（base="v2"，exp="v0"） |
| `enable_tsid_vector_from_ai_creative` | 是否走 ai_creative_v2 直查源（当前 false） |

**v0 全零向量的消融设计**：exp 组读 v0 → 零向量 → 线上余弦退化为常数 → 分数只含用户 bias——"无个性化"基线。配对验证 DSSM 创意匹配的增量（实测业务指标持平，分析见对话记录）。

线上消费链路（ad-core 侧，供交叉参考）：

```
ad_server DAG: user_vector 模块 → predictor calculateVector（用户塔模型）
  → user_vec + bias + model_timestamp
ad_creative: rkey = {tsid}_{cplfans_user_vec_version}_{model_timestamp}
  → Redis 查创意向量 → sigmoid(cos×10 + bias) → 创意优选打分
```

---

## 7. 关键配置速查

| 配置项 | 当前值 | 说明 |
|---|---|---|
| incr_mode / window | hour / 1 | 小时级增量 |
| batch_size | 4096 | 训练 batch |
| 塔结构 | user[128,64,8] / ad[128,128,128] / bias[128,1] | 输出 8 维向量 + 1 维 bias |
| 打分公式 | sigmoid(cosine×10 + user_bias) | w=10 硬编码在模型代码 |
| optimizer | Adagrad lr=0.01, acc=1e-4 | |
| 向量时间窗 | 每版本 2 个时间戳滑动 | 覆盖 predictor 切换过渡期 |
| valid_version_code | v4,v2,v0 | 线上向量保留的版本 |
| 闸门 | auc>0.80, gap∈[-0.56,0.56] | 比精排宽（排序能力优先） |
| 向量护栏 | 行数 [1e3, 5e6)，行/字节差异 ≤60% | 防向量大面积丢失 |
| 向量保留 | 168 个历史文件（一周） | |
| Redis 表 | ocpx_strategy / creative_ad_vector_cpl_upfans | key 格式 `tsid_v{N}_{ts}` |
| sample_vec_table | dssm_table_cpl_upfans_tsid_dssm_gate_v2 | 向量推理结果 hive 表 |
| 数据源 | viewfs://c9/user_ext/ads_rank/model/zoo/model_id=d_m_21527 | 上游共享工作区 |

---

## 附：目录内其他文件

| 文件 | 作用 |
|---|---|
| `emb_comp.py` / `emb_comp_v2.py` / `emb_comp.sh` | 向量对比分析工具（离线推理 vs 线上版本、特征一致性 diff） |
| `test.sh` / `test.py` / `pred.py` / `tower_score.py` | 单点调试：单文件训练、向量上传测试、打分公式复现脚本 |
| `huizhu.sh` | 常用命令速查（拉起训练循环、手动触发各阶段） |
| `dssm_ad_model/online_ad_vec` | 线上向量文件本地副本（多版本合并后的全量，~9.7 万 tsid） |
| `part-00099` | 向量批量推理样本输出（logid/prob/label/cosine/bias/user_vec/ad_vec/pv 九列） |
| `log_20260817*` 等 | 历史阶段日志归档 |
