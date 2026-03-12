---
name: earnings-report-analyzer
description: 上市公司财报分析定时任务。每天自动抓取巨潮资讯新发布的年报摘要，使用 GLM 模型进行 AI 分析，生成包含关键数据、亮点分析、投资建议的摘要，推送消息并汇总到 CSV 和飞书云文档。触发词：财报分析、上市公司财报、定期报告抓取。
metadata:
  openclaw:
    emoji: "📊"
    requires:
      bins:
        - summarize
      env:
        - Z_AI_API_KEY
    install: []
---

# 上市公司财报分析

自动化抓取、分析、汇总上市公司财报的定时任务技能。

## 功能概览

本技能使用 **agent-browser** 自动打开巨潮资讯网站，搜索指定日期发布的年报摘要，提取 PDF 链接进行分析。

1. **抓取财报**: 使用 agent-browser 从巨潮资讯获取年报摘要
2. **AI 分析**: 使用 summarize + GLM-4-flash 生成结构化摘要
3. **消息推送**: 每份财报独立推送给用户
4. **数据汇总**: 所有结果写入本地 CSV 文件
5. **飞书云文档**: 自动创建文档 → 写入内容 → 推送链接

## 定时任务配置

```bash
# 使用 OpenClaw cron 设置每天 10:00 执行
openclaw cron add "0 10 * * *" --name "earnings-report-daily" --system-event "EARNINGS_REPORT_ANALYZE"
```

## 手动执行

```bash
{baseDir}/scripts/run.sh
```

## 输出文件

| 文件 | 说明 |
|------|------|
| `~/.earnings-reports/reports.csv` | 所有财报分析结果汇总 |
| `~/.earnings-reports/daily/YYYY-MM-DD.json` | 每日原始抓取数据 |
| `~/.earnings-reports/notifications/*.txt` | 每份财报摘要 |
| `~/.earnings-reports/notifications/每日汇总_*.txt` | 每日汇总报告 |
| `~/.earnings-reports/notifications/飞书文档链接_*.txt` | 飞书云文档链接记录 |
| `~/.earnings-reports/pending_docs/*.md` | 待处理文档（备用） |

## 飞书云文档集成

### 自动化流程

任务完成后自动执行以下步骤：

```
┌─────────────────────────────────────────┐
│  1. 创建文档 (feishu_doc action=create)  │
│              ↓                          │
│  2. 写入内容 (feishu_doc action=write)   │
│              ↓                          │
│  3. 推送链接到飞书                        │
└─────────────────────────────────────────┘
```

### 实现方式

通过 OpenClaw Gateway API (`localhost:3691/api/invoke/feishu_doc`) 调用：

```javascript
// 步骤1: 创建文档
POST /api/invoke/feishu_doc
{ "action": "create", "title": "2026-03-09 上市公司年报摘要详细分析" }

// 步骤2: 写入内容
POST /api/invoke/feishu_doc
{ "action": "write", "doc_token": "xxx", "content": "# 完整 Markdown 内容..." }

// 步骤3: 推送链接
sendToFeishu("📄 飞书云文档已创建\n🔗 https://feishu.cn/docx/xxx")
```

### 备用机制

如果 Gateway 不可用，内容会保存到 `~/.earnings-reports/pending_docs/` 目录，等待后续处理。

## 配置项

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `Z_AI_API_KEY` | 智谱 AI API Key | (必需) |
| `EARNINGS_OUTPUT_DIR` | 输出目录 | `~/.earnings-reports` |

**注意**: 飞书云文档功能通过 OpenClaw Gateway 自动处理，无需额外配置 `FEISHU_ACCESS_TOKEN`。

## 分析输出格式

每份财报摘要包含：

```
## 📊 [公司名称] 年报摘要分析

### 💰 财务情况
- 营业收入: XX 亿元 (同比 +/-XX%)
- 净利润: XX 亿元 (同比 +/-XX%)
- 毛利率: XX%
- 净利率: XX%
- 现金流: XX 亿元
- 每股收益: XX 元
- 净资产收益率: XX%

### ✨ 业务亮点
1. ...
2. ...

### 📈 未来趋势
- 行业前景: ...
- 公司规划: ...
- 增长驱动: ...

### ⚠️ 风险提示
- ...

### 💡 投资建议
**买入/持有/观望** — 理由
```

## 飞书云文档内容结构

```
# YYYY-MM-DD 上市公司年报摘要详细分析

## 📊 投资建议汇总
| 建议 | 数量 | 公司 |
|------|------|------|
| 买入 | N家 | 公司A、公司B... |
| 持有 | N家 | ... |
| 观望 | N家 | ... |

## 📋 详细分析
### 1. 公司名称 (股票代码) ⭐
- 关键数据
- 亮点分析
- 风险提示
- 投资建议

## 📊 投资建议统计
```

## CSV 汇总字段

| 字段 | 说明 |
|------|------|
| date | 发布日期 |
| company | 公司名称 |
| code | 股票代码 |
| report_type | 报告类型 |
| revenue | 营业收入 |
| net_profit | 净利润 |
| yoy_growth | 同比增长率 |
| highlights | 亮点摘要 |
| risks | 风险提示 |
| recommendation | 投资建议 |
| source_url | 原始链接 |
| analyzed_at | 分析时间 |

## 相关文件

| 文件 | 说明 |
|------|------|
| `scripts/run.sh` | 主执行脚本 |
| `scripts/fetch-reports.js` | 财报抓取脚本 |
| `scripts/analyze-reports.js` | 财报分析脚本（含飞书文档集成） |
| `scripts/create-feishu-doc.sh` | 飞书文档辅助脚本（备用） |
