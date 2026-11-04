# 公司财务数据展示平台

本地部署，首页展示公司集合（公司名称 + logo），点击公司 logo 进入对应公司的财务数据详情页。当前已收录宁德时代、贵州茅台、泡泡玛特、特斯拉、拼多多。

## 核心指标
- 营业收入
- 毛利润
- 净利润
- 毛利率
- 净利率
- 自由现金流

季度数据说明：
- A 股为单季度口径：一季度=一季报，二季度=中报−一季报，三季度=三季报−中报，四季度=全年−三季报。
- 美股接口直接提供单季度数据。
- 港股只有年报和中报，详情页按半年度展示（下半年=年报−中报）。

## 数据源与市场支持
- 数据源：东方财富公开接口
- A 股：支持（`.SH` / `.SZ` / `.BJ`）
- 港股：支持（`.HK`），财报披露频率为半年
- 美股：支持（`.O` / `.N` 等），可获取单季度数据
- 私有公司（如 SpaceX）：无公开财报，无法获取

## 技术栈
- 后端：FastAPI + SQLAlchemy + SQLite + APScheduler
- 前端：Next.js 13 + TypeScript + Tailwind CSS + Recharts
- 数据源：东方财富公开接口

## 启动方式

### 1. 启动后端（端口8000）
```bash
cd /root/financial-dashboard/backend
PYTHONPATH=/root/financial-dashboard/backend python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. 启动前端（端口3000）
```bash
cd /root/financial-dashboard/frontend
npm run dev
```

## 自动更新
后端启动时会自动执行一次数据更新，并设置每日 06:00 自动更新。

## 页面结构
- `/`：公司集合页，仅展示公司名称与 logo
- `/company/[code]`：公司财务数据详情页，例如 `/company/300750.SZ`

## 新增公司
1. 在 `backend/app/core/config.py` 的 `TARGET_COMPANIES` 中增加公司：`code`、`name`、`logo_url`、`currency`。
2. 将公司 logo 放入 `frontend/public/logos/`，并将 `logo_url` 设为 `/logos/<文件名>`；未设置 logo 时会自动显示公司名称首字作为占位图标。
3. 重启后端，系统会自动写入公司记录并抓取财务数据；每日 06:00 自动更新。

## 访问地址
- 前端：http://localhost:3000
- 后端API：http://localhost:8000
- API文档：http://localhost:8000/docs
