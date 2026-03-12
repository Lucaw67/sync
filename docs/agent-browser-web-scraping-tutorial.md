# Agent-Browser 网页抓取教程

本教程教你如何使用 `agent-browser` 抓取动态网页数据，以**巨潮资讯年报抓取**为实战案例。

---

## 📋 目录

1. [什么是 agent-browser](#什么是-agent-browser)
2. [基础命令](#基础命令)
3. [核心工作流程](#核心工作流程)
4. [实战案例：抓取巨潮资讯年报](#实战案例抓取巨潮资讯年报)
5. [高级技巧](#高级技巧)
6. [常见问题](#常见问题)

---

## 什么是 agent-browser

`agent-browser` 是一个 Rust 编写的无头浏览器自动化工具，专为 AI Agent 设计：

**特点**：
- 🚀 快速：Rust 实现，比 Puppeteer/Playwright 快 3-5 倍
- 🤖 AI 友好：命令简单，输出结构化，适合 Agent 调用
- 🔒 安全：沙箱隔离，不暴露敏感信息
- 📦 轻量：无需安装 Chrome/Chromium

**适用场景**：
- 动态网页抓取（JavaScript 渲染）
- 表单自动填写
- 数据提取
- 网页截图
- 自动化测试

---

## 基础命令

### 1. 打开网页
```bash
agent-browser open "https://example.com"
```

### 2. 等待加载
```bash
# 等待固定时间（毫秒）
agent-browser wait 3000

# 等待元素出现
agent-browser wait "#content" --timeout 10000
```

### 3. 获取页面快照
```bash
# 获取页面结构
agent-browser snapshot

# 输出格式：
# - DOM 树结构
# - 可交互元素列表
# - 表单字段
```

### 4. 执行 JavaScript
```bash
# 提取数据
agent-browser eval "document.title"

# 复杂提取（返回 JSON）
agent-browser eval "JSON.stringify({title: document.title, url: location.href})"
```

### 5. 点击元素
```bash
# 通过选择器点击
agent-browser click "#submit-button"

# 通过文本点击
agent-browser click --text "登录"
```

### 6. 输入文本
```bash
# 填写输入框
agent-browser type "#search-input" "关键词"

# 带回车的输入
agent-browser type "#search-input" "关键词" --enter
```

### 7. 截图
```bash
# 整页截图
agent-browser screenshot --full-page

# 指定元素截图
agent-browser screenshot "#chart" --output chart.png
```

### 8. 关闭浏览器
```bash
agent-browser close
```

---

## 核心工作流程

### 标准 5 步流程

```
┌─────────────┐
│  1. Open    │  打开目标网页
└──────┬──────┘
       ↓
┌─────────────┐
│  2. Wait    │  等待页面加载（JS 渲染）
└──────┬──────┘
       ↓
┌─────────────┐
│  3. Snapshot│  获取页面快照（了解结构）
└──────┬──────┘
       ↓
┌─────────────┐
│  4. Eval    │  执行 JS 提取数据
└──────┬──────┘
       ↓
┌─────────────┐
│  5. Close   │  关闭浏览器
└─────────────┘
```

---

## 实战案例：抓取巨潮资讯年报

### 需求
从巨潮资讯（cninfo.com.cn）抓取指定日期发布的上市公司年度报告摘要列表。

### 挑战
1. **动态加载**：列表通过 JavaScript 渲染
2. **分页**：需要处理分页逻辑
3. **链接转换**：列表页是详情页链接，需要再访问获取真实 PDF 链接

### 解决方案架构

```
搜索页 → 提取详情页链接 → 逐一访问 → 提取 PDF 链接 → 汇总输出
```

### 完整代码解析

#### 步骤 1：封装 agent-browser 调用

```javascript
const { execSync } = require('child_process');

function runAgentBrowser(args, timeout = 60000) {
  try {
    const result = execSync(`agent-browser ${args}`, {
      encoding: 'utf-8',
      timeout: timeout,
    });
    return { success: true, output: result };
  } catch (e) {
    return { success: false, output: e.stdout || e.stderr || e.message };
  }
}
```

**要点**：
- 使用 `execSync` 同步执行
- 捕获成功/失败两种情况
- 设置超时防止卡死

---

#### 步骤 2：打开搜索页

```javascript
// 打开巨潮资讯搜索页面
const result = runAgentBrowser(
  `open "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search&checkedCategory=category_ndbg_szsh"`
);

// 等待页面加载（JS 渲染需要时间）
runAgentBrowser('wait 5000');
```

**要点**：
- URL 需要引号包裹
- 等待时间根据网站速度调整（3-5 秒通常足够）

---

#### 步骤 3：获取快照（调试用）

```javascript
const snapshotResult = runAgentBrowser('snapshot');
console.error('快照长度:', snapshotResult.output.length);
```

**作用**：
- 了解页面结构
- 验证页面是否正确加载
- 开发时使用，生产环境可注释

---

#### 步骤 4：提取详情页链接（核心）

```javascript
// 构造提取脚本
const extractJs = `
(function() {
  // 1. 获取所有链接
  const allLinks = Array.from(document.querySelectorAll('a'));
  const detailUrls = [];
  
  // 2. 过滤符合条件的链接
  allLinks.forEach(link => {
    const text = link.textContent.trim();
    const href = link.href;
    
    // 过滤条件：
    // - 包含"年度报告"
    // - 包含"摘要"（排除全文）
    // - 链接包含 disclosure/detail
    if (text.includes('年度报告') && 
        text.includes('摘要') &&
        href && href.includes('disclosure/detail')) {
      
      // 3. 提取关键参数
      const annIdMatch = href.match(/announcementId=(\\d+)/);
      const annTimeMatch = href.match(/announcementTime=([^&]+)/);
      
      // 4. 获取股票代码和名称（从父行）
      let row = link.closest('tr');
      const cells = row.querySelectorAll('td');
      
      detailUrls.push({
        code: cells[0]?.textContent.trim() || '',
        name: cells[1]?.textContent.trim() || '',
        title: text,
        announcementId: annIdMatch ? annIdMatch[1] : '',
        announcementTime: annTimeMatch ? annTimeMatch[1] : '',
        detailUrl: href
      });
    }
  });
  
  // 5. 去重
  const seen = new Set();
  return detailUrls.filter(r => {
    if (seen.has(r.announcementId)) return false;
    seen.add(r.announcementId);
    return true;
  });
})();
`;

// 执行提取
const evalResult = runAgentBrowser(`eval "${extractJs.replace(/"/g, '\\"')}"`);
```

**要点**：
1. **立即执行函数**：`(function(){ ... })()` 避免污染全局作用域
2. **返回 JSON**：方便后续解析
3. **转义引号**：shell 中双引号需要转义为 `\"`
4. **去重**：防止重复抓取

---

#### 步骤 5：解析提取结果

```javascript
let detailUrls = [];
try {
  let jsonStr = evalResult.output.trim();
  
  // 处理 JSON 字符串转义
  if (jsonStr.startsWith('"') && jsonStr.endsWith('"')) {
    jsonStr = jsonStr.slice(1, -1);
  }
  jsonStr = jsonStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  
  // 提取 JSON 数组
  const jsonMatch = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (jsonMatch) {
    detailUrls = JSON.parse(jsonMatch[0]);
    console.error(`成功提取 ${detailUrls.length} 份报告`);
  }
} catch (e) {
  console.error('JSON 解析失败:', e.message);
}
```

**常见问题**：
- `eval` 返回的 JSON 可能被多层转义
- 使用正则提取最内层的 JSON 数组

---

#### 步骤 6：逐一访问详情页获取 PDF

```javascript
const reports = [];

for (const item of detailUrls) {
  console.error(`访问: ${item.name} (${item.code})`);
  
  // 打开详情页
  runAgentBrowser(`open "${item.detailUrl}"`);
  runAgentBrowser('wait 2000');
  
  // 提取 PDF 链接
  const pdfResult = runAgentBrowser(
    `eval "const a=document.querySelector('a[href*=\\\".PDF\\\"]');JSON.stringify({pdfUrl:a?a.href:''});"`
  );
  
  // 解析结果
  try {
    let pdfStr = pdfResult.output.trim();
    if (pdfStr.startsWith('"') && pdfStr.endsWith('"')) {
      pdfStr = pdfStr.slice(1, -1);
    }
    pdfStr = pdfStr.replace(/\\"/g, '"');
    
    const pdfMatch = pdfStr.match(/\{[^}]+\}/);
    if (pdfMatch) {
      const pdfInfo = JSON.parse(pdfMatch[0]);
      if (pdfInfo.pdfUrl) {
        reports.push({
          ...item,
          pdfUrl: pdfInfo.pdfUrl
        });
        console.error(`  ✓ PDF: ${pdfInfo.pdfUrl}`);
      }
    }
  } catch (e) {
    console.error(`  ✗ 获取 PDF 失败`);
  }
}
```

**优化建议**：
- 添加延迟防止请求过快（`setTimeout`）
- 设置最大重试次数
- 记录失败项便于后续补抓

---

#### 步骤 7：关闭浏览器并输出

```javascript
// 关闭浏览器
runAgentBrowser('close');

// 输出结果
console.log(JSON.stringify({
  date: TARGET_DATE,
  fetchTime: new Date().toISOString(),
  source: 'agent-browser',
  reports: reports,
  total: reports.length
}, null, 2));
```

---

## 高级技巧

### 1. 处理分页

```javascript
async function fetchAllPages() {
  let allData = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    // 打开当前页
    runAgentBrowser(`open "https://example.com/list?page=${page}"`);
    runAgentBrowser('wait 2000');
    
    // 提取数据
    const result = runAgentBrowser('eval "JSON.stringify(extractData())"');
    const data = JSON.parse(result.output);
    
    if (data.length === 0) {
      hasMore = false;
    } else {
      allData = allData.concat(data);
      page++;
    }
  }
  
  return allData;
}
```

### 2. 处理登录

```javascript
// 1. 打开登录页
runAgentBrowser('open "https://example.com/login"');
runAgentBrowser('wait 2000');

// 2. 填写表单
runAgentBrowser('type "#username" "your_username"');
runAgentBrowser('type "#password" "your_password"');

// 3. 点击登录
runAgentBrowser('click "#login-button"');
runAgentBrowser('wait 3000');

// 4. 验证登录成功
const result = runAgentBrowser('eval "document.querySelector(\'.user-info\') !== null"');
if (result.output.includes('true')) {
  console.log('登录成功');
}
```

### 3. 处理弹窗/对话框

```javascript
// 等待并处理 alert/confirm/prompt
runAgentBrowser('eval "window.alert = () => {}"'); // 忽略 alert
runAgentBrowser('eval "window.confirm = () => true"'); // 自动确认
```

### 4. 处理 iframe

```javascript
// 切换到 iframe
runAgentBrowser('eval "frames[0].document.querySelector(\'.content\').textContent"');
```

### 5. 处理动态加载（无限滚动）

```javascript
async function handleInfiniteScroll() {
  let lastHeight = 0;
  let currentHeight = 0;
  
  do {
    lastHeight = currentHeight;
    
    // 滚动到底部
    runAgentBrowser('eval "window.scrollTo(0, document.body.scrollHeight)"');
    runAgentBrowser('wait 2000');
    
    // 获取新高度
    const result = runAgentBrowser('eval "document.body.scrollHeight"');
    currentHeight = parseInt(result.output);
  } while (currentHeight > lastHeight);
}
```

---

## 常见问题

### Q1: 页面加载慢，数据提取不完整？

**A**: 增加等待时间，或使用智能等待：

```javascript
// 等待特定元素出现
runAgentBrowser('wait ".data-loaded" --timeout 10000');
```

### Q2: eval 返回的 JSON 无法解析？

**A**: 检查转义和嵌套：

```javascript
// 正确的转义方式
const js = 'JSON.stringify({key: "value"})';
runAgentBrowser(`eval "${js.replace(/"/g, '\\"')}"`);
```

### Q3: 元素选择器找不到？

**A**: 使用快照调试：

```javascript
const snapshot = runAgentBrowser('snapshot');
console.error(snapshot.output); // 查看实际的 DOM 结构
```

### Q4: 如何处理验证码？

**A**: 
1. 使用代理 IP 池
2. 降低请求频率
3. 调用第三方验证码识别服务
4. 使用 cookies 绕过（人工登录后保存）

### Q5: 内存占用过高？

**A**: 
- 及时关闭浏览器（`close`）
- 批量处理时分段执行
- 使用 `--headless` 模式（默认）

---

## 最佳实践

### 1. 错误处理

```javascript
function safeRun(args, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const result = runAgentBrowser(args);
    if (result.success) return result;
    console.error(`重试 ${i + 1}/${retries}: ${args}`);
  }
  throw new Error(`执行失败: ${args}`);
}
```

### 2. 日志记录

```javascript
function log(message) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${message}`);
}

log('开始抓取...');
log(`成功提取 ${data.length} 条数据`);
```

### 3. 速率限制

```javascript
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

for (const url of urls) {
  await processUrl(url);
  await sleep(1000); // 每次请求间隔 1 秒
}
```

### 4. 数据验证

```javascript
function validateReport(report) {
  if (!report.company || !report.url) {
    return false;
  }
  if (!report.url.includes('.PDF') && !report.url.includes('.pdf')) {
    return false;
  }
  return true;
}

const validReports = reports.filter(validateReport);
```

---

## 完整示例代码

查看实战代码：
- 抓取脚本：`scripts/fetch-reports.js`
- 分析脚本：`scripts/analyze-reports.js`
- 运行脚本：`scripts/run.sh`

GitHub 仓库：https://github.com/Lucaw67/sync

---

## 总结

### 核心要点

1. **5 步流程**：Open → Wait → Snapshot → Eval → Close
2. **数据提取**：使用立即执行函数 + JSON 返回
3. **错误处理**：重试机制 + 日志记录
4. **性能优化**：合理等待 + 速率限制

### 适用场景

- ✅ 动态网页（JavaScript 渲染）
- ✅ 需要交互的页面（点击、滚动）
- ✅ 复杂数据提取
- ❌ 简单静态页面（用 curl/requests 更快）
- ❌ 大规模爬虫（考虑专业框架）

---

**作者**: OpenClaw AI Assistant  
**更新日期**: 2026-03-12  
**版本**: 1.0
