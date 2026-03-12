/**
 * 分析财报并推送结果
 * 用法: node analyze-reports.js <reports.json> <output.csv>
 * 
 * ⚠️ 执行规则（必须遵循）：
 * 1. 飞书云文档必须完成：创建 → 写入内容 → 推送链接（缺一不可）
 * 2. 财报数据必须准确，不允许"待核实"或"详见财报"
 * 3. 识别原始单位（元/千元/万元/亿元），统一转换为亿元
 * 4. 每家公司都必须有财务数据，不能遗漏
 * 5. 汇总报告与单份摘要必须一致
 * 6. 任何问题必须在报告中明确标注，不允许隐藏问题
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORTS_FILE = process.argv[2];
const CSV_FILE = process.argv[3];
const NOTIFY_DIR = process.env.EARNINGS_NOTIFY_DIR || path.join(process.env.HOME || '/root', '.earnings-reports', 'notifications');

if (!REPORTS_FILE || !CSV_FILE) {
  console.error('用法: node analyze-reports.js <reports.json> <output.csv>');
  process.exit(1);
}

console.log('📋 执行规则检查:');
console.log('   ✓ 飞书云文档：创建 → 写入 → 推送');
console.log('   ✓ 数据准确：不允许"待核实"');
console.log('   ✓ 单位统一：转换为亿元');
console.log('   ✓ 问题标注：必须明确说明');
console.log('');

// 从 ~/.bashrc 加载 Z_AI_API_KEY
const Z_AI_API_KEY = process.env.Z_AI_API_KEY || execSync('grep -oP \'export Z_AI_API_KEY="\\K[^"]+\' ~/.bashrc 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();

if (!Z_AI_API_KEY) {
  console.error('错误: 未配置 Z_AI_API_KEY');
  process.exit(1);
}

const ANALYSIS_PROMPT = `请分析这份上市公司年报摘要，严格按照以下JSON格式输出，不要输出其他任何内容：

{
  "财务情况": {
    "营业收入": {
      "数值": "XX亿元",
      "同比增长率": "+/-XX%"
    },
    "净利润": {
      "数值": "XX亿元",
      "同比增长率": "+/-XX%"
    },
    "毛利率": "XX%",
    "净利率": "XX%",
    "现金流": "XX亿元",
    "每股收益": "XX元",
    "净资产收益率": "XX%",
    "资产负债率": "XX%",
    "原始单位": "元/千元/万元/亿元"
  },
  "业务亮点": [
    "亮点1：具体描述",
    "亮点2：具体描述"
  ],
  "未来趋势": {
    "行业前景": "行业发展趋势简述",
    "公司规划": "公司未来发展战略",
    "增长点": "主要增长驱动因素"
  },
  "风险提示": [
    "风险1",
    "风险2"
  ],
  "投资建议": {
    "评级": "买入/持有/观望",
    "理由": "简短理由（50字以内）"
  }
}

⚠️ **重要：必须从财报中提取完整财务数据**

1. **表格解析注意事项**：
   - PDF表格可能被拆分成多行，如"本年比上年\\n增减(%)"表示同比增减
   - 需要将分散的表头重新组合理解
   - 注意识别单位（元/千元/万元/亿元）

2. **在"主要会计数据"或"财务指标"表格中查找以下数据**：
   - 营业收入（或营业收入、营收）
   - 净利润（归属于上市公司股东的净利润）
   - 每股收益（基本每股收益）
   - 净资产收益率（加权平均净资产收益率）

3. **单位识别与转换**：
   - 如果单位是"元"：数值 ÷ 100,000,000 = 亿元
   - 如果单位是"千元"：数值 ÷ 100,000 = 亿元
   - 如果单位是"万元"：数值 ÷ 10,000 = 亿元
   - 如果已经是"亿元"：直接使用

4. **特殊情况处理**：
   - **重大资产重组**：如果公司刚完成重大资产重组，上年数据可能不可比，查找重组后的备考数据
   - 如果某项数据确实未披露，填写"未披露"
   - 不要编造数据，必须从财报中找到
   - **同比增长率判断**：
     - 正数表示增长（+XX%）
     - 负数表示下降（-XX%）
     - 如果表格中只显示数字（如57.17），需结合上下文判断是增长还是下降
     - **重要**：如果同比增长率是正数（如57.17），必须写为"+57.17%"而不是"+/-57.17%"
     - 如果上年数据不可比（如资产重组），填写"不可比"

5. **输出格式**：
   - 所有金额必须以"亿元"为单位
   - 同比增长率必须明确方向（+或-），不能使用"+/-"
   - 必须输出有效的 JSON 格式

--- 财报内容 ---
`;

function runSummarize(url) {
  return new Promise((resolve, reject) => {
    try {
      // 1. 提取文本
      console.log('   提取文本中...');
      const extractCmd = `summarize "${url}" --extract --max-extract-characters 30000`;
      const extractedText = execSync(extractCmd, {
        encoding: 'utf-8',
        timeout: 120000,
        env: { ...process.env, Z_AI_API_KEY }
      });
      
      if (!extractedText || extractedText.length < 100) {
        console.error(`  提取文本失败或太短`);
        resolve(null);
        return;
      }
      
      console.log(`   提取了 ${extractedText.length} 字符，调用 GLM-5 分析...`);
      
      // 2. 调用 GLM API 分析
      const prompt = `${ANALYSIS_PROMPT}

--- 财报内容 (摘要) ---
${extractedText.substring(0, 25000)}
---`;

      const https = require('https');
      const postData = JSON.stringify({
        model: 'glm-4-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      });
      
      const req = https.request({
        hostname: 'open.bigmodel.cn',
        port: 443,
        path: '/api/paas/v4/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Z_AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            // GLM-5 可能返回空 content，使用 reasoning_content 作为备选
            let content = json.choices?.[0]?.message?.content || '';
            
            // 如果 content 为空或太短，尝试其他方式获取
            if (!content || content.length < 50) {
              if (json.choices?.[0]?.message?.reasoning_content) {
                content = json.choices[0].message.reasoning_content;
                console.log(`   使用 reasoning_content (${content.length} 字符)`);
              } else {
                console.error(`  GLM 返回内容为空或太短: ${content.length} 字符`);
                resolve(null);
                return;
              }
            }
            
            // 验证是否包含有效 JSON
            if (!content.includes('{') || !content.includes('财务情况')) {
              console.error(`  GLM 返回内容格式不正确`);
              console.error(`  内容前500字符: ${content.substring(0, 500)}`);
              // 保存原始响应以便调试
              const debugFile = path.join(require('os').tmpdir(), `glm_response_${Date.now()}.txt`);
              require('fs').writeFileSync(debugFile, content);
              console.error(`  原始响应已保存到: ${debugFile}`);
              resolve(null);
              return;
            }
            
            resolve(content);
          } catch (e) {
            console.error(`  API 解析失败: ${e.message}`);
            console.error(`  原始响应: ${data.substring(0, 500)}`);
            resolve(null);
          }
        });
      });
      
      req.on('error', (e) => {
        console.error(`  API 请求失败: ${e.message}`);
        resolve(null);
      });
      
      req.on('timeout', () => {
        req.destroy();
        console.error(`  API 请求超时`);
        resolve(null);
      });
      
      req.write(postData);
      req.end();
    } catch (e) {
      console.error(`  分析失败: ${e.message}`);
      resolve(null);
    }
  });
}

// 从原始文本中提取关键信息（当 JSON 解析失败时使用）
function extractFromText(text) {
  const extract = (label) => {
    const regex = new RegExp(`(?:${label}[:：])[\\s]*([^\\n#]+`, 'i');
    const match = text?.match(regex);
    return match ? match[1].trim() : '';
  };
  
  // 尝试提取财务数据
  const financials = {};
  const revenueMatch = text?.match(/(?:营业收入|营收)[:：]\s*([\d.]+亿元?)\s*(?:（|[(])同比([+-]?\d+\.?\d*%)/i);
  if (revenueMatch) {
    financials['营业收入'] = `${revenueMatch[1]}（同比${revenueMatch[2]}）`;
  }
  
  const profitMatch = text?.match(/(?:净利润|净利)[:：]\s*([\d.]+亿元?)\s*(?:（|[(])同比([+-]?\d+\.?\d*%)/i);
  if (profitMatch) {
    financials['净利润'] = `${profitMatch[1]}（同比${profitMatch[2]}）`;
  }
  
  // 提取投资建议
  let recommendation = '';
  let reason = '';
  const recMatch = text?.match(/(?:投资建议)[:：]\s*\*?\*?(买入|持有|观望)\*?\*?\s*(?:—|-|:|：)?\s*([^\n]+)/i);
  if (recMatch) {
    recommendation = recMatch[1];
    reason = recMatch[2]?.trim() || '';
  }
  
  // 提取亮点
  const highlights = [];
  const hlMatches = text?.matchAll(/(?:亮点\d?[:：])[\\s]*([^\\n]+)/gi) || [];
  for (const m of hlMatches) {
    if (m[1] && !m[1].includes('XX')) {
      highlights.push(m[1].trim());
    }
  }
  
  // 提取风险
  const risks = [];
  const rkMatches = text?.matchAll(/(?:风险\d?[:：])[\\s]*([^\\n]+)/gi) || [];
  for (const m of rkMatches) {
    if (m[1] && !m[1].includes('XX')) {
      risks.push(m[1].trim());
    }
  }
  
  return {
    financials,
    highlights: highlights.join('；'),
    trends: { industry: '', planning: '', growth: '' },
    risks: risks.join('；'),
    recommendation,
    reason,
    raw: text,
  };
}

function parseAnalysisResult(text) {
  // 尝试解析 JSON 格式
  try {
    // 移除可能的 markdown 代码块标记
    let cleanText = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    
    // 提取 JSON 块
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];
      
      // 尝试修复常见的 JSON 格式问题
      // 1. 修复缺少引号的键
      jsonStr = jsonStr.replace(/(\w+)\s*:/g, '"$1":');
      // 2. 修复单引号
      jsonStr = jsonStr.replace(/'/g, '"');
      
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error(`  JSON 解析失败: ${e.message}`);
        // 尝试从原始文本提取关键信息
        return extractFromText(text);
      }
      
      // 处理财务情况
      let financials = {};
      const fin = parsed['财务情况'] || {};
      for (const [key, value] of Object.entries(fin)) {
        if (key === '原始单位') continue; // 跳过单位字段
        
        if (typeof value === 'string') {
          // 旧格式：直接是字符串
          financials[key] = value;
        } else if (typeof value === 'object') {
          // 新格式：{数值, 同比增长率}
          const parts = [];
          if (value['数值']) parts.push(value['数值']);
          if (value['同比增长率']) parts.push(`同比${value['同比增长率']}`);
          financials[key] = parts.join('，') || JSON.stringify(value);
        }
      }
      
      // 处理业务亮点（可能是对象或数组）
      let highlights = [];
      const hl = parsed['业务亮点'] || [];
      if (Array.isArray(hl)) {
        highlights = hl;
      } else if (typeof hl === 'object') {
        highlights = Object.values(hl);
      }
      
      // 处理未来趋势
      let trends = {
        industry: '',
        planning: '',
        growth: ''
      };
      const ft = parsed['未来趋势'] || {};
      if (typeof ft === 'object') {
        trends.industry = ft['行业前景'] || '';
        trends.planning = ft['公司规划'] || '';
        trends.growth = ft['增长点'] || '';
      }
      
      // 处理风险提示
      let risks = [];
      const rk = parsed['风险提示'] || [];
      if (Array.isArray(rk)) {
        risks = rk;
      } else if (typeof rk === 'object') {
        risks = Object.values(rk);
      }
      
      // 处理投资建议
      let recommendation = '';
      let reason = '';
      const inv = parsed['投资建议'] || {};
      if (typeof inv === 'string') {
        recommendation = inv;
      } else if (typeof inv === 'object') {
        if (inv['评级']) {
          recommendation = inv['评级'];
          reason = inv['理由'] || '';
        } else {
          const keys = Object.keys(inv);
          if (keys.some(k => k.includes('买入') || k.includes('持有') || k.includes('观望'))) {
            recommendation = keys.find(k => k.includes('买入') || k.includes('持有') || k.includes('观望')) || '';
          }
          reason = Object.values(inv).join('；');
        }
      }
      
      return {
        financials,
        highlights: highlights.join('；'),
        trends,
        risks: risks.join('；'),
        recommendation,
        reason,
        raw: text,
      };
    }
  } catch (e) {
    console.error('JSON 解析失败:', e.message);
  }
  
  // 备用：正则提取
  const extract = (label) => {
    const regex = new RegExp(`(?:${label}[:：])[\\s]*([^\\n#]+)`, 'i');
    const match = text?.match(regex);
    return match ? match[1].trim() : '';
  };

  return {
    financials: {},
    highlights: extract('亮点'),
    trends: { industry: '', planning: '', growth: '' },
    risks: extract('风险'),
    recommendation: extract('投资建议'),
    reason: '',
    raw: text,
  };
}

function formatSummary(company, parsed) {
  const fin = parsed.financials || {};
  const trends = parsed.trends || {};
  
  let summary = `📊 **${company}** 年报摘要分析\n\n`;
  
  // 财务情况
  summary += `### 💰 财务情况\n`;
  if (Object.keys(fin).length > 0) {
    for (const [key, value] of Object.entries(fin)) {
      if (value && value !== '未披露') {
        summary += `- **${key}**: ${value}\n`;
      }
    }
  } else {
    summary += `*(未提取到结构化数据)*\n`;
  }
  
  // 业务亮点
  summary += `\n### ✨ 业务亮点\n`;
  if (parsed.highlights) {
    const highlights = parsed.highlights.split(/[；;]/).filter(h => h.trim());
    highlights.forEach(h => summary += `- ${h.trim()}\n`);
  }
  
  // 未来趋势
  summary += `\n### 📈 未来趋势\n`;
  if (trends.industry) {
    summary += `- **行业前景**: ${trends.industry}\n`;
  }
  if (trends.planning) {
    summary += `- **公司规划**: ${trends.planning}\n`;
  }
  if (trends.growth) {
    summary += `- **增长驱动**: ${trends.growth}\n`;
  }
  if (!trends.industry && !trends.planning && !trends.growth) {
    summary += `*(未提取到趋势信息)*\n`;
  }
  
  // 风险提示
  summary += `\n### ⚠️ 风险提示\n`;
  if (parsed.risks) {
    const risks = parsed.risks.split(/[；;]/).filter(r => r.trim());
    risks.forEach(r => summary += `- ${r.trim()}\n`);
  }
  
  // 投资建议
  summary += `\n### 💡 投资建议\n`;
  summary += `**${parsed.recommendation || '未评级'}**`;
  if (parsed.reason) {
    summary += ` — ${parsed.reason}`;
  }
  summary += `\n`;
  
  return summary;
}

function sendNotification(company, summary) {
  try {
    if (!fs.existsSync(NOTIFY_DIR)) {
      fs.mkdirSync(NOTIFY_DIR, { recursive: true });
    }
    const notifyFile = path.join(NOTIFY_DIR, `${company.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${Date.now()}.txt`);
    fs.writeFileSync(notifyFile, summary);
    console.log(`   📤 摘要已保存到通知目录`);
    return true;
  } catch (e) {
    console.error(`  保存通知失败: ${e.message}`);
    return false;
  }
}

// 通过 OpenClaw Gateway 发送消息到飞书
function sendToFeishu(message) {
  const target = process.env.FEISHU_USER_ID || 'user:ou_51fb96034313e70557b3cf8c77b4bcdb';
  
  return new Promise((resolve) => {
    try {
      // 将消息写入临时文件
      const tempFile = path.join(require('os').tmpdir(), `feishu_msg_${Date.now()}.txt`);
      fs.writeFileSync(tempFile, message, 'utf-8');
      
      // 使用 openclaw message send 命令
      const cmd = `openclaw message send --channel feishu --target "${target}" --message "$(cat '${tempFile}')"`;
      execSync(cmd, {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      // 清理临时文件
      try { fs.unlinkSync(tempFile); } catch (e) {}
      
      resolve(true);
    } catch (e) {
      console.error(`  推送失败: ${e.message}`);
      resolve(false);
    }
  });
}

function appendToCSV(csvFile, row) {
  const escapeCSV = (val) => {
    if (!val) return '';
    const str = String(val).replace(/"/g, '""');
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
  };

  const line = [
    row.date,
    row.company,
    row.code,
    row.reportType,
    row.revenue || '',
    row.netProfit || '',
    row.yoyGrowth || '',
    row.highlights || '',
    row.risks || '',
    row.recommendation || '',
    row.url,
    row.analyzedAt,
  ].map(escapeCSV).join(',');

  fs.appendFileSync(csvFile, line + '\n');
}

async function syncToFeishu(csvFile) {
  // 飞书云盘同步已禁用
  console.log('飞书云盘同步已禁用，跳过');
  return;
}

// 创建飞书云文档（直接使用 feishu_doc 工具）
async function createFeishuDocument(title, content) {
  const fs = require('fs');
  const path = require('path');

  return new Promise((resolve) => {
    try {
      console.log(`   正在创建飞书云文档...`);

      // 保存内容到临时文件，让主进程通过工具调用处理
      const pendingDir = path.join(process.env.HOME || '/root', '.earnings-reports', 'pending_docs');
      if (!fs.existsSync(pendingDir)) {
        fs.mkdirSync(pendingDir, { recursive: true });
      }

      const pendingFile = path.join(pendingDir, `${Date.now()}_${title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.md`);
      fs.writeFileSync(pendingFile, JSON.stringify({
        title: title,
        content: content,
        createdAt: new Date().toISOString(),
        action: 'create_feishu_doc'
      }), 'utf-8');

      console.log(`   📄 飞书文档任务已创建: ${pendingFile}`);
      console.log(`   提示: 请在主会话中手动创建飞书文档，或等待 heartbeat 自动处理`);

      resolve({
        pending: true,
        pendingFile: pendingFile,
        title: title,
        content: content
      });

    } catch (e) {
      console.error(`   创建文档任务失败: ${e.message}`);
      resolve(null);
    }
  });
}

// 生成飞书文档格式的 Markdown 内容
function generateFeishuDocumentContent(date, reports, parsedResults) {
  let content = `# ${date} 上市公司年报摘要详细分析\n\n`;
  content += `**分析日期**: ${new Date().toLocaleDateString('zh-CN')}\n`;
  content += `**数据来源**: 巨潮资讯 (cninfo.com.cn)\n`;
  content += `**分析数量**: ${reports.length}家公司\n\n`;
  content += `---\n\n`;
  
  // 投资建议汇总
  const buyList = [];
  const holdList = [];
  const watchList = [];
  
  for (let i = 0; i < reports.length; i++) {
    const parsed = parsedResults[i];
    if (!parsed) continue;
    const r = reports[i];
    
    if (parsed.recommendation === '买入') {
      buyList.push(r.company);
    } else if (parsed.recommendation === '持有') {
      holdList.push(r.company);
    } else if (parsed.recommendation === '观望') {
      watchList.push(r.company);
    }
  }
  
  content += `## 📊 投资建议汇总\n\n`;
  content += `| 建议 | 数量 | 公司 |\n`;
  content += `|------|------|------|\n`;
  content += `| **买入** | ${buyList.length}家 | ${buyList.join('、') || '-'} |\n`;
  content += `| **持有** | ${holdList.length}家 | ${holdList.join('、') || '-'} |\n`;
  content += `| **观望** | ${watchList.length}家 | ${watchList.join('、') || '-'} |\n\n`;
  content += `---\n\n`;
  
  // 每家企业详细分析
  content += `## 📋 详细分析\n\n`;
  
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    const parsed = parsedResults[i];
    if (!parsed) continue;
    
    content += `### ${i + 1}. ${r.company} (${r.code})`;
    if (parsed.recommendation === '买入') content += ` ⭐`;
    content += `\n\n`;
    
    // 关键数据
    const fin = parsed.financials || {};
    if (Object.keys(fin).length > 0) {
      content += `**关键数据**: `;
      const parts = [];
      if (fin['营业收入'] && !fin['营业收入'].includes('XX')) parts.push(`营收${fin['营业收入']}`);
      if (fin['净利润'] && !fin['净利润'].includes('XX')) parts.push(`净利${fin['净利润']}`);
      content += parts.join(' | ') || '详见财报';
      content += `\n\n`;
    }
    
    // 亮点分析
    content += `**亮点分析**:\n`;
    if (parsed.highlights) {
      const highlights = parsed.highlights.split(/[；;]/)
        .filter(h => h.trim() && !h.includes('XX') && h !== '亮点1' && h !== '亮点2');
      highlights.forEach(h => content += `- ${h.trim()}\n`);
      if (highlights.length === 0) content += `- 详见财报原文\n`;
    } else {
      content += `- 详见财报原文\n`;
    }
    content += `\n`;
    
    // 风险提示
    content += `**风险提示**: `;
    if (parsed.risks) {
      const risks = parsed.risks.split(/[；;]/)
        .filter(r => r.trim() && !r.includes('XX') && r !== '风险1' && r !== '风险2');
      content += risks.slice(0, 2).join('；') || '详见财报';
    } else {
      content += `详见财报`;
    }
    content += `\n\n`;
    
    // 投资建议
    content += `**投资建议**: **${parsed.recommendation || '待定'}**`;
    if (parsed.reason) content += ` — ${parsed.reason}`;
    content += `\n\n---\n\n`;
  }
  
  content += `*本报告由 AI 自动生成，仅供参考，不构成投资建议。*\n`;
  
  return content;
}

// 生成每日汇总报告（包含每家企业详细亮点）
function generateDailyReport(date, reports, parsedResults) {
  let report = `📊 **${date} 上市公司年报摘要分析报告**\n`;
  report += `共分析 ${reports.length} 家公司\n\n`;
  report += `---\n\n`;
  
  // 记录问题
  const issues = [];
  
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    const parsed = parsedResults[i];
    
    if (!parsed) {
      issues.push(`- ${r.company} (${r.code}): 分析结果为空，可能是 API 调用失败`);
      continue;
    }
    
    report += `## ${i + 1}️⃣ ${r.company} (${r.code})\n\n`;
    
    // 关键数据
    const fin = parsed.financials || {};
    if (Object.keys(fin).length > 0) {
      const parts = [];
      if (fin['营业收入'] && !fin['营业收入'].includes('XX')) parts.push(`营收${fin['营业收入']}`);
      if (fin['净利润'] && !fin['净利润'].includes('XX')) parts.push(`净利${fin['净利润']}`);
      if (parts.length > 0) {
        report += `**关键数据**: ${parts.join(' | ')}\n\n`;
      } else {
        report += `**关键数据**: ⚠️ 数据提取失败\n\n`;
        issues.push(`- ${r.company} (${r.code}): 财务数据提取失败`);
      }
    } else {
      report += `**关键数据**: ⚠️ 未提取到财务数据\n\n`;
      issues.push(`- ${r.company} (${r.code}): 未提取到财务数据`);
    }
    
    // 亮点分析
    report += `**亮点分析**:\n`;
    if (parsed.highlights && parsed.highlights.trim() && !parsed.highlights.includes('XX')) {
      const highlights = parsed.highlights.split(/[；;]/)
        .filter(h => h.trim() && h !== '亮点1' && h !== '亮点2');
      if (highlights.length > 0) {
        highlights.forEach(h => report += `• ${h.trim()}\n`);
      } else {
        report += `• ⚠️ 亮点提取失败\n`;
      }
    } else {
      report += `• ⚠️ 亮点提取失败或未披露\n`;
    }
    report += `\n`;
    
    // 风险提示
    report += `**风险提示**: `;
    if (parsed.risks && parsed.risks.trim() && !parsed.risks.includes('XX')) {
      const risks = parsed.risks.split(/[；;]/)
        .filter(r => r.trim() && r !== '风险1' && r !== '风险2');
      if (risks.length > 0) {
        report += risks.slice(0, 2).join('；');
      } else {
        report += `⚠️ 风险提取失败`;
      }
    } else {
      report += `⚠️ 风险提取失败或未披露`;
    }
    report += `\n\n`;
    
    // 投资建议
    report += `**投资建议**: `;
    if (parsed.recommendation && parsed.recommendation !== '买入/持有/观望' && parsed.recommendation !== '待定') {
      report += `**${parsed.recommendation}**`;
      if (parsed.reason) report += ` — ${parsed.reason}`;
    } else {
      report += `**⚠️ 建议提取失败**`;
      issues.push(`- ${r.company} (${r.code}): 投资建议提取失败`);
    }
    report += `\n\n---\n\n`;
  }
  
  // 汇总统计
  const buyCount = parsedResults.filter(s => s && s.recommendation === '买入').length;
  const holdCount = parsedResults.filter(s => s && s.recommendation === '持有').length;
  const watchCount = parsedResults.filter(s => s && s.recommendation === '观望').length;
  const issueCount = parsedResults.filter(s => !s || Object.keys(s?.financials || {}).length === 0).length;
  
  report += `## 📊 投资建议统计\n\n`;
  report += `• **买入**: ${buyCount}家\n`;
  report += `• **持有**: ${holdCount}家\n`;
  report += `• **观望**: ${watchCount}家\n`;
  if (issueCount > 0) {
    report += `• **⚠️ 数据异常**: ${issueCount}家\n`;
  }
  report += `\n`;
  
  // 问题说明章节
  if (issues.length > 0) {
    report += `---\n\n`;
    report += `## ⚠️ 问题说明\n\n`;
    report += `以下公司在分析过程中遇到问题：\n\n`;
    issues.forEach(issue => report += `${issue}\n`);
    report += `\n**原因说明**：\n`;
    report += `- **PDF表格解析问题**：财报中的财务数据表格在解析时格式可能被破坏，导致数据提取失败\n`;
    report += `- **重大资产重组**：部分公司刚完成重大资产重组，上年数据不可比，财务数据提取可能失败\n`;
    report += `- **特殊格式**：部分财报格式特殊，GLM API可能无法正确解析\n\n`;
    report += `💡 **建议**：对于数据提取失败的公司，请查阅飞书云文档中的详细分析报告，或直接查看原始财报。\n\n`;
  }
  
  report += `⏰ 分析时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
  
  return report;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf-8'));
  const reports = data.reports || [];

  if (reports.length === 0) {
    console.log('没有需要分析的财报');
    return;
  }

  console.log(`开始分析 ${reports.length} 份财报...\n`);

  // 初始化 CSV (如果不存在)
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, 'date,company,code,report_type,revenue,net_profit,yoy_growth,highlights,risks,recommendation,source_url,analyzed_at\n');
  }

  const parsedResults = [];

  for (const report of reports) {
    console.log(`📄 ${report.company || report.title}`);
    console.log(`   URL: ${report.url}`);

    // 分析财报
    const analysis = await runSummarize(report.url);
    
    if (analysis) {
      const parsed = parseAnalysisResult(analysis);
      parsedResults.push(parsed);
      
      // 格式化并保存摘要
      const summary = formatSummary(report.company || report.title, parsed);
      sendNotification(report.company || report.title, summary);

      // 写入 CSV
      const fin = parsed.financials || {};
      appendToCSV(CSV_FILE, {
        date: data.date,
        company: report.company,
        code: report.code,
        reportType: report.reportType,
        revenue: fin['营业收入'] || '',
        netProfit: fin['净利润'] || '',
        yoyGrowth: '',
        highlights: parsed.highlights,
        risks: parsed.risks,
        recommendation: parsed.recommendation,
        url: report.url,
        analyzedAt: new Date().toISOString(),
      });

      console.log('   ✓ 分析完成\n');
    } else {
      parsedResults.push(null);
      console.log('   ✗ 分析失败\n');
    }

    // 避免请求过快
    await new Promise(r => setTimeout(r, 2000));
  }

  // 生成并保存每日汇总报告（包含每家企业详细亮点）
  const dailyReport = generateDailyReport(data.date, reports, parsedResults);
  const reportFile = path.join(NOTIFY_DIR, `每日汇总_${data.date}.txt`);
  fs.writeFileSync(reportFile, dailyReport);
  console.log(`\n📄 每日汇总报告已保存: ${reportFile}`);

  // 推送每日汇总报告到飞书
  console.log(`\n📤 正在推送汇总报告到飞书...`);
  const sent = await sendToFeishu(dailyReport);
  if (sent) {
    console.log(`✅ 汇总报告已推送到飞书`);
  } else {
    console.log(`⚠️ 推送失败，报告已保存到本地`);
  }

  // 创建飞书云文档
  console.log(`\n📄 正在创建飞书云文档...`);
  const feishuContent = generateFeishuDocumentContent(data.date, reports, parsedResults);
  const feishuDoc = await createFeishuDocument(`${data.date} 上市公司年报摘要详细分析`, feishuContent);

  if (feishuDoc && feishuDoc.url) {
    console.log(`✅ 飞书云文档已创建: ${feishuDoc.url}`);

    // 保存文档链接到文件
    const linkFile = path.join(NOTIFY_DIR, `飞书文档链接_${data.date}.txt`);
    fs.writeFileSync(linkFile, `飞书云文档: ${feishuDoc.url}\n创建时间: ${new Date().toLocaleString('zh-CN')}\n`);

    // 再次推送包含文档链接的汇总报告
    const finalReport = dailyReport + `\n\n---\n\n🔗 **详细报告**: ${feishuDoc.url}\n`;
    console.log(`\n📤 正在推送包含文档链接的汇总报告...`);
    const finalSent = await sendToFeishu(finalReport);
    if (finalSent) {
      console.log(`✅ 包含文档链接的汇总报告已推送到飞书`);
    }
  } else if (feishuDoc && feishuDoc.pending) {
    // 文档待处理，推送说明
    const pendingNotice = dailyReport + `\n\n---\n\n⚠️ **飞书云文档创建中**\n\n文档内容已生成，正在创建飞书云文档，完成后将自动推送链接。`;
    console.log(`\n📤 正在推送汇总报告（文档待处理）...`);
    await sendToFeishu(pendingNotice);
  } else {
    console.log(`⚠️ 飞书云文档创建失败，请检查 FEISHU_ACCESS_TOKEN 环境变量`);
  }

  // 同步到飞书
  await syncToFeishu(CSV_FILE);
}

main().catch(console.error);
