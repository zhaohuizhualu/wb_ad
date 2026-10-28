---
title: CPL 广告精排模型解析：DeepFM 骨架上的 STAR、PPNet 与多模态长序列注意力
date: 2026-10-28
excerpt: 拆解微博 CPL 广告精排预估模型 star_multimodal_long_seq 的完整技术方案——小时级增量训练、DeepFM 一阶/FM 二阶、两域 STAR 多场景拓扑、PPNet 个性化门控，以及 GSU/ESU 多模态长序列目标注意力的组合设计与工程细节。
tags:
  - 推荐系统
  - 计算广告
  - CTR预估
  - 深度学习
---

## 为什么写这篇文章

微博广告的 CPL（Cost Per Lead，按转化收费）投放体系里，精排模型承担的角色是：对召回和粗排筛出的候选广告，预估"这次曝光最终会不会带来深转（引导/转化）"，预估分直接决定排序和出价。这个模型（内部代号 `star_multimodal_long_seq`）在一个真实业务里持续跑了很久，迭代出不少有意思的工程决策。本文完整拆解它的结构、训练流程和背后的取舍，适合想了解工业级精排模型全貌的读者。

先交代三个容易被误解的业务口径：

- **虽然目录名叫 CTR，它实际预估的不是点击**，label 是"模型口径转化数或上报流引导数 ≥ 1"的深转事件；
- **它是小时级增量模型**，不是每日全量重训——每个小时的新数据在上一小时模型的基础上续训一个 epoch；
- **训练数据由上游工作区统一生产**，本项目只负责训练和评估，样本链路不在本文展开。

---

## 模型全景：五个组件各管什么

一句话概括：**DeepFM 打底，STAR 分域，PPNet 个性化，SimTier 做多模态分数统计，GSU+ESU 做长序列注意力**。整体数据流如下：

```
                        ┌────────────────────────────────────────────┐
 sparse/dense ids ──→  fm_w [5e7]        (一阶 LR 权重)  ──→ First-order
                        │                                            │
                        fm_v [5e7 × 8]  (8 维共享 embedding)          │
                        │                                            │
      multi-hot sqrt pooling                                          │
                        │                                            │
   ┌────────────────────┼────────────────────────────┐               │
   ▼                    ▼                            ▼               ▼
 GSU/ESU 长序列    deep slots concat + simtier      wide slots → FM 二阶交叉
 (多模态注意力)    统计 → BN → concat(att_output)         0.5*(Σ²−Σ²)
                        │
              STAR 拓扑 FCN [128,128,128,32]（每域独立 kernel/bias，共 2 域）
              每层经 PPNet 门控（gate = 2·sigmoid(MLP(...))）
                        │
              末层拼接 [一阶 | FM 二阶 | FCN 输出 | auxiliary slots emb]
              ×PPNet_last_layer → 每域独立线性层 → 按场景加权和
                        │
              logits → sigmoid → pred
```

下面逐个组件讲清楚"为什么需要它"。

---

## 一、嵌入层：5e7 哈希词表与 sqrt pooling

模型没有用 embedding table，直接用 `tf.get_variable` 建两张大表：

- `fm_w [5e7]`：一阶 LR 权重，每个特征 hash 一个标量
- `fm_v [5e7, 8]`：8 维共享 embedding，LR / FM / DNN 三路共用

所有离散特征先 hash 进 `[1, 5000万)` 的空间再查表。5e7 的规模是权衡：真实特征数远超这个量级（用户/广告/交叉/序列 ID），必然碰撞，但 8 维 embedding 下的碰撞损失可接受，换来的是**词表大小固定**——增量训练时新出现的特征直接落进已有空间，不需要动态扩表。

多值特征（行为序列、兴趣标签）的池化用 `sqrt pooling`：`sum(emb) / sqrt(有效长度)`。这是序列建模的经典 trick——直接 sum 会随长度线性放大，平均又丢失长度信息，sqrt 池化介于两者之间。

---

## 二、STAR：两个"域"就够了吗

多场景建模是这个模型的第一个特色。微博 CPL 广告的流量分成两个域：

- **视频场景域**：6 个视频类 ps_id
- **其他域**：剩余所有场景

STAR 的做法是 FCN 每层的 kernel/bias **按域独立**（`domain_kernel_{d}{i}`），输入共享，输出按场景 one-hot 加权求和。这解决了"不同场景的最优映射不同"的问题——视频场景的转化规律和图文场景显然不一样，硬用一个 FCN 会互相拖累。

为什么只有 2 个域而不是把每个 ps_id 单独成域？我的理解是**样本量的现实约束**：域内参数要靠该域的数据喂饱，ps_id 有几十个，长尾场景单独成域会严重欠拟合。2 域划分（视频 vs 非视频）保证每个域都有充足数据，这是小规模 STAR 的务实选择。

---

## 三、PPNet：用 12 个身份特征给整个网络"调音"

PPNet（Personalized Permute Net）的思路：选一批**身份类 slot**（本模型用 `ppnet_slot = [2,3,43,6,32,33,34,35,250,50,841,842,843]`，即广告主、广告计划、优化目标、创意语义码等 12 个），它们的 embedding 拼接过 BN，再和 `stop_gradient` 的 deep 输入（512 维投影）一起进 2 层 MLP，输出 `2·sigmoid(x)` ∈ (0,2) 的门控向量，**逐层逐维**乘到 STAR FCN 的每一层上。

直观理解：同一套网络骨架，对"美妆广告主的样本"和"游戏广告主的样本"施加不同的变换强度。广告主 ID 类特征不直接参与预测，而是作为"个性化调制信号"——这比把它们简单塞进 deep 输入更高效，因为门控作用在了每一层。

---

## 四、SimTier：把 200 维多模态分数压成 21 维统计

模型有一个很特别的 dense 特征 `mm_simscores_long [200]`：**当前广告创意与用户长期行为序列里各 item 的多模态相似度分数**（图文/视频 embedding 算出的预计算分数）。直接把 200 维分数喂进网络有两个问题：item 数不固定（序列长短不一）、原始分数噪声大。

SimTier 的解法是**做直方图**：按 0.05~0.95 共 20 个边界分桶，统计 200 个分数落在每桶的比例（log1p 平滑 + LayerNorm），再拼上 `valid_ratio`（≥-1 的有效比例），得到 21 维统计量直接进 deep 输入。这个设计把"序列的相似度分布形状"编码成一个固定维度的向量——"高相似 item 很多"和"只有个别高分"是两种截然不同的兴趣匹配信号，直方图天然能区分。

---

## 五、GSU + ESU：长序列注意力的两段式

这是模型里最重的组件，处理三条用户序列（uid 曝光序列 / 时间差桶 / 行为码，各 ≤200 item）：

**GSU（General Search Unit，检索）**：200 个 item 全做注意力太贵，先按 `sim_threshold=0.3` 过滤 + `top_k=20` 取与 target 最相似的子集。这是 SIM 论文"先搜索后建模"思想的落地。

**ESU（Exact Search Unit，精排）**：对筛出的 ≤20 个 item 做多头目标注意力（4 head、output 32 维）。两个有意思的细节：

1. **多模态分数直接参与注意力分布**：`use_mm_in_fusion_att=true` 时，`mm_simscores` 过 relu 后以可学习的 `gamma1/gamma2` 与注意力权重线性融合再归一化——attention 学到的"相关性"和预计算的多模态相似度**融合**而不是二选一；
2. **时间差特征**（slot 990/991）拼进 history embedding，让模型感知行为的时间远近。

target 是 slot 2（广告主 embedding）。一个实践中反复强调过的细节：`att_tar_slots=['2']` 是**广告主身份位**，不要按字面叫它"用户 ID"。

---

## 六、损失、优化器与一个关键的工程数字

- 损失：sigmoid cross entropy + 全量 L2 正则（linear/embedding 1e-7）
- 优化器：**Adagrad，lr=0.015，initial_accumulator_value=1e-4**——这里有个值得记的教训：稀疏 embedding 需要高学习率（Adagrad 累加器消融实验曾验证 1e-5 全胜 +12bp，预判反转过一次），daily 模型用它不是保守而是刚需

评估 batch size 定在 **2048** 也有故事：batch 4096 在某个特定数据 split 上会稳定触发 TF native segfault，8192 和 2048 的 AUC 完全一致但 2048 零 OOM 零 segfault——这是踩了坑之后拿稳定性换来的数字。

---

## 七、小时级增量训练闭环

```
循环A（特征生产）: hive/Spark 抽样本 → xfea slot 化 + hash → _SUCCESS 触发
循环B（增量训练）: 
  扫描 _SUCCESS 选 1 小时窗口
  → parquet 化（hadoop streaming: 过滤黑名单 + shuffle + hash 进 slot）
  → ml-submit 提交 k8s GPU 容器（4090×2, 32G），从上一小时模型 restore 后训 1 epoch
  → 下一小时数据上评估 multi_auc
  → 闸门: auc > 0.80 且 gap ∈ [-0.08, 0.10]
     通过 → touch hour.model.done，成为下轮基座
     不通过 → 不标记，数据滚动累计重训（不丢数据）
```

几个值得展开的机制：

**评估闸门**。每小时模型必须在下一小时数据上 AUC>0.80 且相对变化不超过 ±8~10% 才能成为下一轮的基座。这防住了两种事故：脏数据把模型带崩、以及增量训练的缓慢漂移。失败时不丢数据——样本滚进下一轮继续训，模型停在最后一个健康版本上。

**checkpoint 分片恢复**。`fm_w/fm_v` 各 5e7 参数，单分片直接全量 restore；多分片时这两张大表及其 Adagrad accumulator 被 exclude 出常规恢复，用 `VarLoadHook` 按 5e6 一批 `scatter_update` 精确重排加载（处理 partitioner 的交错布局）。这是参数服务器时代大变量恢复的标准姿势。

**增量基座切换**。如果增量链落后于 batch 链（比如增量挂了几天），脚本会自动切到 batch 模型做基座并回补天级数据，保证增量模型不会和全量模型差距越拉越大。

---

## 八、写给大家的三个 takeaway

1. **组合拳比单点创新重要**。这个模型没有惊世骇俗的单项技术，DeepFM 是 2017 年的、STAR 是 2021 年的、SIM 也是 2021 年的——但把它们组合成一个小时级增量系统，每个组件都精确对应一个业务问题（场景差异→STAR，个性化→PPNet，长序列→GSU/ESU，多模态→SimTier+注意力融合），工程收益是复利的。

2. **口径比模型重要**。"目录叫 CTR 但预估的是转化"、"冷启动是转化正样本数阈值不是曝光量阈值"、"self_uc 是线上 is_self 字段不是长尾桶"——每一次复盘分析里口径错误导致的误判，都比模型结构本身的坑更多。写分析前先对齐口径，这一课值很多钱。

3. **评估基础设施是隐形竞争力**。同窗口配对比较、AUC 闸门、逐窗口日志（每个 evaluate.test 记录四项指标 + 样本数 + 正例数）、batch size 的 segfault 排障记录——这些让"模型 A 比模型 B 好 0.5bp"这句话有据可查。没有这套基础设施，所有优化都是玄学。

---

## 附：关键配置速查

| 配置项 | 当前值 | 说明 |
|---|---|---|
| incr_mode | hour | 小时级增量 |
| batch_size | 1536 | 训练 batch |
| feature_size / embedding_size | 5e7 / 8 | hash 词表规模与 embedding 维度 |
| fcn | [128,128,128,32] | STAR FCN 结构 |
| top_k / sim_threshold | 20 / 0.3 | GSU 检索参数 |
| mha_num_heads / att_output_dim | 4 / 32 | ESU 多头注意力 |
| num_domains | 2 | 视频场景 vs 其他 |
| optimizer | Adagrad lr=0.015 | initial_accumulator=1e-4 |
| auc_min / gap 区间 | 0.80 / [-0.08, 0.10] | 发布闸门 |
| dense 特征 | mm_simscores_long (200维) | 多模态相似度分数向量 |

> 完整的目录结构、hive SQL 样本口径、特征清单（305 行 feature_list.conf 的逐类解析）等细节见工作区 `cpl_ctr_base/readme.md`；本文聚焦模型结构与训练机制本身。
