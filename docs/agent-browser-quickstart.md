# Agent-Browser 快速入门

## 安装

```bash
# 检查是否已安装
which agent-browser

# 如果未安装，查看 skill 文档
cat ~/.openclaw/workspace/skills/agent-browser/SKILL.md
```

## 5 分钟上手

### 1️⃣ 打开网页
```bash
agent-browser open "https://example.com"
```

### 2️⃣ 等待加载
```bash
agent-browser wait 3000  # 等待 3 秒
```

### 3️⃣ 获取快照（查看页面结构）
```bash
agent-browser snapshot
```

### 4️⃣ 提取数据
```bash
# 简单提取
agent-browser eval "document.title"

# 提取多个数据（返回 JSON）
agent-browser eval 'JSON.stringify({
  title: document.title,
  url: location.href,
  content: document.querySelector("article")?.textContent
})'
```

### 5️⃣ 关闭浏览器
```bash
agent-browser close
```

## 实战模板

### 模板 1：提取列表数据

```javascript
const { execSync } = require('child_process');

function runBrowser(cmd) {
  return execSync(`agent-browser ${cmd}`, { encoding: 'utf-8' });
}

// 1. 打开页面
runBrowser('open "https://example.com/list"');
runBrowser('wait 3000');

// 2. 提取数据
const extractJs = `
(function() {
  const items = Array.from(document.querySelectorAll('.item'));
  return items.map(item => ({
    title: item.querySelector('.title')?.textContent,
    link: item.querySelector('a')?.href
  }));
})();
`;

const result = runBrowser(`eval "${extractJs.replace(/"/g, '\\"')}"`);
const data = JSON.parse(result);

// 3. 关闭
runBrowser('close');

console.log(data);
```

### 模板 2：表单填写

```javascript
// 1. 打开登录页
runBrowser('open "https://example.com/login"');
runBrowser('wait 2000');

// 2. 填写表单
runBrowser('type "#username" "your_username"');
runBrowser('type "#password" "your_password"');

// 3. 提交
runBrowser('click "#submit"');
runBrowser('wait 3000');

// 4. 验证
const result = runBrowser('eval "document.querySelector(\'.welcome\')?.textContent"');
console.log('登录结果:', result);
```

### 模板 3：分页抓取

```javascript
let allData = [];
let page = 1;

while (true) {
  runBrowser(`open "https://example.com/list?page=${page}"`);
  runBrowser('wait 2000');
  
  const result = runBrowser('eval "JSON.stringify(extractItems())"');
  const items = JSON.parse(result);
  
  if (items.length === 0) break;
  
  allData = allData.concat(items);
  page++;
}

runBrowser('close');
console.log(`共抓取 ${allData.length} 条数据`);
```

## 常用命令速查

| 命令 | 说明 | 示例 |
|------|------|------|
| `open` | 打开网页 | `open "https://example.com"` |
| `wait` | 等待 | `wait 3000` 或 `wait "#element"` |
| `snapshot` | 获取快照 | `snapshot` |
| `eval` | 执行 JS | `eval "document.title"` |
| `click` | 点击 | `click "#button"` 或 `click --text "登录"` |
| `type` | 输入 | `type "#input" "text"` |
| `screenshot` | 截图 | `screenshot --output page.png` |
| `close` | 关闭 | `close` |

## 调试技巧

### 1. 查看页面结构
```bash
agent-browser snapshot > page-structure.txt
```

### 2. 测试选择器
```bash
agent-browser eval "document.querySelectorAll('a').length"
```

### 3. 保存截图
```bash
agent-browser screenshot --full-page --output debug.png
```

## 常见错误

### 错误 1：元素找不到
```
❌ Error: Element not found
```
**解决**：增加等待时间，或检查选择器是否正确

### 错误 2：JSON 解析失败
```
❌ SyntaxError: Unexpected token
```
**解决**：检查 JS 返回值格式，确保返回有效 JSON

### 错误 3：超时
```
❌ Error: Timeout
```
**解决**：增加 `--timeout` 参数，或优化脚本

## 下一步

- 📖 [完整教程](agent-browser-web-scraping-tutorial.md)
- 🔗 [实战案例](https://github.com/Lucaw67/sync)
- 📚 [Skill 文档](~/.openclaw/workspace/skills/agent-browser/SKILL.md)

---

**快速帮助**：
- 卡住了？先 `snapshot` 看看页面结构
- 数据不对？`eval` 返回前先 `console.log` 调试
- 太慢了？减少 `wait` 时间，或批量处理
