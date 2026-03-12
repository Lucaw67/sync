# 上市公司年报分析器 (Earnings Report Analyzer)

自动抓取、分析、推送上市公司年度报告摘要。

## 功能特性

- 🔄 **自动抓取**：从巨潮资讯 (cninfo.com.cn) 抓取最新年报摘要
- 🤖 **AI 分析**：使用 GLM-5 分析财报，提取关键财务数据
- 📊 **汇总报告**：生成每日汇总报告，包含投资建议统计
- 📄 **飞书推送**：自动推送到飞书聊天，创建飞书云文档
- ⏰ **定时执行**：支持定时任务，每日自动运行

## 目录结构

```
.
├── README.md                           # 本文件
├── SKILL.md                            # OpenClaw 技能说明
├── docs/
│   ├── agent-browser-quickstart.md     # Agent-Browser 快速入门
│   └── agent-browser-web-scraping-tutorial.md  # 完整抓取教程
└── scripts/
    ├── analyze-reports.js              # 分析脚本（核心）
    ├── fetch-reports.js                # 抓取脚本
    ├── create-feishu-doc.sh            # 飞书文档创建
    └── run.sh                          # 运行脚本
```

## 快速开始

### 前置要求

- Node.js 18+
- `summarize` CLI (用于 PDF 解析)
- GLM API Key (`Z_AI_API_KEY`)

### 运行分析

```bash
# 抓取昨日财报
node scripts/fetch-reports.js

# 分析财报
node scripts/analyze-reports.js <reports.json> <output.csv>
```

## 核心功能

### 1. 财务数据提取

从 PDF 财报中提取：
- 营业收入（同比增减）
- 净利润（同比增减）
- 每股收益
- 净资产收益率
- 毛利率、净利率
- 现金流

### 2. 业务分析

- 业务亮点识别
- 未来趋势分析
- 风险提示提取

### 3. 投资建议

基于财务数据自动生成：
- 买入
- 持有
- 观望

## 使用教程

### 📚 Agent-Browser 抓取教程

本项目的财报抓取功能使用 `agent-browser` 实现。我们提供了详细的教程：

1. **[快速入门](docs/agent-browser-quickstart.md)** - 5 分钟上手
   - 基础命令
   - 实战模板
   - 常见问题

2. **[完整教程](docs/agent-browser-web-scraping-tutorial.md)** - 深入学习
   - 工作流程
   - 巨潮资讯抓取案例（逐行解析）
   - 高级技巧（分页、登录、无限滚动）
   - 最佳实践

### 教程亮点

- ✅ 真实案例代码（非示例）
- ✅ 每行代码都有注释
- ✅ 即用型模板
- ✅ 常见错误解决方案

## 配置

### 环境变量

```bash
# GLM API 密钥
export Z_AI_API_KEY="your_key_here"

# 飞书用户 ID（用于推送）
export FEISHU_USER_ID="user:ou_xxx"

# Gateway 端口
export OPENCLAW_GATEWAY_PORT="18789"
```

### 飞书配置

1. 创建飞书应用
2. 获取 App ID 和 App Secret
3. 配置到 OpenClaw

## 输出示例

### 汇总报告

```
📊 2026-03-11 上市公司年报摘要分析报告

共分析 16 家公司

投资建议分布:
- 买入: 7家 (奇德新材、重庆啤酒、工业富联...)
- 持有: 3家 (天味食品、汇通能源、亚联发展)
- 观望: 5家 (冠豪高新、岳阳林纸...)

亮点推荐 ⭐:
- 工业富联: 营收9,028.87亿元（+48.22%），净利352.86亿元（+51.99%）
- 金海通: 净利同比+125.93%，芯片测试分选领域领先
```

### 飞书云文档

自动创建包含：
- 投资建议汇总表
- 每家公司详细分析
- 关键财务数据
- 亮点与风险

## 技术栈

- **PDF 解析**: summarize CLI + markitdown
- **AI 分析**: GLM-5 (智谱 AI)
- **消息推送**: OpenClaw Gateway
- **云文档**: 飞书 API
- **网页抓取**: agent-browser

## 更新日志

### 2026-03-12
- ✅ 修复财务数据提取失败问题
- ✅ 优化 PDF 表格解析
- ✅ 修复云文档链接推送
- ✅ 增强错误日志记录
- ✅ 添加 Agent-Browser 完整教程

### 2026-03-10
- ✅ 初始版本发布
- ✅ 支持 16 家公司同时分析
- ✅ 集成飞书推送

## 常见问题

### Q: 财务数据提取失败？

**A**: 检查以下几点：
1. PDF 是否成功下载
2. GLM API 是否正常
3. 查看错误日志了解具体原因

### Q: 云文档没有推送？

**A**: 确保：
1. 飞书集成已配置
2. `FEISHU_USER_ID` 正确
3. Gateway 正在运行

### Q: 如何添加新的数据源？

**A**: 修改 `scripts/fetch-reports.js`：
1. 添加新的抓取逻辑
2. 统一输出格式
3. 运行测试

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT

## 作者

luca67

## 相关链接

- [OpenClaw 文档](https://docs.openclaw.ai)
- [Agent-Browser Skill](~/.openclaw/workspace/skills/agent-browser/SKILL.md)
- [ClawHub 技能市场](https://clawhub.com)
