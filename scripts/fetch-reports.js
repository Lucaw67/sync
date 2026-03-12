/**
 * 使用 agent-browser 从巨潮资讯抓取财报列表
 * 用法: node fetch-reports.js <YYYY-MM-DD> [manual_url1] [manual_url2] ...
 */

const { execSync } = require('child_process');
const fs = require('fs');

const TARGET_DATE = process.argv[2] || getYesterdayDate();
const MANUAL_URLS = process.argv.slice(3);

function getYesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

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

async function fetchWithAgentBrowser(date) {
  console.error(`使用 agent-browser 抓取 ${date} 的年报...`);

  // 1. 打开巨潮资讯搜索页面
  console.error('步骤1: 打开页面...');
  let result = runAgentBrowser(`open "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search&checkedCategory=category_ndbg_szsh"`);
  if (!result.success) {
    return { source: 'agent-browser', reports: [], error: '打开页面失败: ' + result.output };
  }

  // 2. 等待页面加载
  console.error('步骤2: 等待页面加载...');
  runAgentBrowser('wait 5000');

  // 3. 获取页面快照
  console.error('步骤3: 获取页面快照...');
  const snapshotResult = runAgentBrowser('snapshot');
  console.error('快照长度:', snapshotResult.output.length);

  // 4. 执行 JavaScript 提取详情页链接
  console.error('步骤4: 提取详情页链接...');
  const extractJs = `
(function() {
  const allLinks = Array.from(document.querySelectorAll('a'));
  const detailUrls = [];
  
  allLinks.forEach(link => {
    const text = link.textContent.trim();
    const href = link.href;
    
    if (text.includes('年度报告') && 
        !text.includes('董事会工作报告') && 
        !text.includes('独立董事述职') &&
        !text.includes('审计委员会履职') &&
        !text.includes('审计委员会对') &&
        text.includes('摘要') &&
        href && href.includes('disclosure/detail')) {
      
      const annIdMatch = href.match(/announcementId=(\\d+)/);
      const annTimeMatch = href.match(/announcementTime=([^&]+)/);
      
      const annId = annIdMatch ? annIdMatch[1] : '';
      const annTime = annTimeMatch ? annTimeMatch[1] : '';
      
      // 获取父行
      let row = link.closest('tr');
      if (!row) {
        row = link.parentElement;
        while (row && row.tagName !== 'TR' && row.tagName !== 'BODY') {
          row = row.parentElement;
        }
      }
      
      let code = '', name = '';
      if (row && row.tagName === 'TR') {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          code = cells[0]?.textContent.trim() || '';
          name = cells[1]?.textContent.trim() || '';
        }
      }
      
      if (annId) {
        detailUrls.push({
          code: code,
          name: name,
          title: text,
          announcementId: annId,
          announcementTime: annTime,
          detailUrl: href
        });
      }
    }
  });
  
  // 去重
  const seen = new Set();
  const unique = detailUrls.filter(r => {
    if (seen.has(r.announcementId)) return false;
    seen.add(r.announcementId);
    return true;
  });
  
  return JSON.stringify(unique);
})();
`;

  const evalResult = runAgentBrowser(`eval "${extractJs.replace(/"/g, '\\"')}"`);
  console.error('eval 结果:', evalResult.output.substring(0, 500));

  // 解析详情页链接
  let detailUrls = [];
  try {
    let jsonStr = evalResult.output.trim();
    if (jsonStr.startsWith('"') && jsonStr.endsWith('"')) {
      jsonStr = jsonStr.slice(1, -1);
    }
    jsonStr = jsonStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const jsonMatch = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      detailUrls = JSON.parse(jsonMatch[0]);
      console.error(`成功提取 ${detailUrls.length} 份报告详情页`);
    }
  } catch (e) {
    console.error('JSON 解析失败:', e.message);
    runAgentBrowser('close');
    return { source: 'agent-browser', reports: [], error: '无法解析详情页数据' };
  }

  // 5. 逐一访问详情页获取真实 PDF 链接
  console.error('步骤5: 获取真实 PDF 链接...');
  const reports = [];
  
  for (const item of detailUrls) {
    console.error(`  访问: ${item.name} (${item.code})`);
    
    // 打开详情页
    runAgentBrowser(`open "${item.detailUrl}"`);
    runAgentBrowser('wait 2000');
    
    // 提取 PDF 链接
    const pdfResult = runAgentBrowser(`eval "const a=document.querySelector('a[href*=\\".PDF\\"],a[href*=\\"static.cninfo\\"]');JSON.stringify({pdfUrl:a?a.href:'',text:a?a.textContent:''});"`);
    
    try {
      let pdfStr = pdfResult.output.trim();
      if (pdfStr.startsWith('"') && pdfStr.endsWith('"')) {
        pdfStr = pdfStr.slice(1, -1);
      }
      pdfStr = pdfStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const pdfMatch = pdfStr.match(/\{[^}]+\}/);
      if (pdfMatch) {
        const pdfInfo = JSON.parse(pdfMatch[0]);
        if (pdfInfo.pdfUrl) {
          reports.push({
            ...item,
            pdfUrl: pdfInfo.pdfUrl
          });
          console.error(`    ✓ PDF: ${pdfInfo.pdfUrl}`);
        }
      }
    } catch (e) {
      console.error(`    ✗ 获取 PDF 失败`);
    }
  }

  // 6. 关闭浏览器
  runAgentBrowser('close');

  return {
    source: 'agent-browser',
    reports: reports,
    total: reports.length,
  };
}

function detectReportType(title) {
  if (!title) return '其他';
  if (title.includes('摘要')) return '年度报告摘要';
  if (title.includes('年度报告') || title.includes('年报')) return '年度报告';
  return '定期报告';
}

// 只保留年报摘要，排除全文
function filterAbstractReportsOnly(reports) {
  return reports.filter(r => r.title.includes('摘要'));
}

async function main() {
  // 如果提供了手动URL，直接使用
  if (MANUAL_URLS.length > 0) {
    const allReports = MANUAL_URLS.map((url, i) => {
      const filename = url.split('/').pop() || `report_${i + 1}`;
      return {
        company: `报告${i + 1}`,
        code: '',
        title: decodeURIComponent(filename.replace(/\.PDF$/i, '')),
        reportType: detectReportType(filename),
        publishDate: TARGET_DATE.replace(/-/g, ''),
        url: url,
      };
    });

    // 只保留年报摘要
    const reports = filterAbstractReportsOnly(allReports);

    console.log(JSON.stringify({
      date: TARGET_DATE,
      fetchTime: new Date().toISOString(),
      source: 'manual',
      reports,
      total: reports.length,
      filtered: allReports.length - reports.length,
    }, null, 2));
    return;
  }

  // 使用 agent-browser 抓取
  const result = await fetchWithAgentBrowser(TARGET_DATE);

  // 格式化输出并过滤掉摘要
  const allReports = result.reports.map(r => ({
    company: r.name || '',
    code: r.code || '',
    title: r.title || '',
    reportType: detectReportType(r.title),
    publishDate: r.announcementTime ? r.announcementTime.split('%20')[0].split(' ')[0].replace(/-/g, '') : TARGET_DATE.replace(/-/g, ''),
    url: r.pdfUrl || '',
  }));

  // 只保留年报摘要
  const reports = filterAbstractReportsOnly(allReports);

  const output = {
    date: TARGET_DATE,
    fetchTime: new Date().toISOString(),
    source: result.source,
    reports,
    total: reports.length,
    filtered: allReports.length - reports.length, // 被过滤掉的摘要数量
  };

  if (result.error) {
    output.error = result.error;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch(console.error);
