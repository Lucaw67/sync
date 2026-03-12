#!/bin/bash
# 上市公司财报分析定时任务
# 每天 10:00 执行，抓取前一天发布的财报并分析

set -e

# 配置
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${EARNINGS_OUTPUT_DIR:-$HOME/.earnings-reports}"
SSE_URL="${EARNINGS_SSE_URL:-https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search&checkedCategory=category_ndbg_szsh}"
DATE_YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
DATE_TODAY=$(date +%Y-%m-%d)
DAILY_DIR="$OUTPUT_DIR/daily"
CSV_FILE="$OUTPUT_DIR/reports.csv"

# 确保环境变量加载
export Z_AI_API_KEY="${Z_AI_API_KEY:-$(grep -oP 'export Z_AI_API_KEY="\K[^"]+' ~/.bashrc 2>/dev/null || true)}"

# 创建输出目录
mkdir -p "$DAILY_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "开始执行财报分析任务..."

# 步骤1: 抓取财报列表
log "正在从上交所抓取 $DATE_YESTERDAY 的财报列表..."
cd "$BASE_DIR"

REPORTS_JSON="$DAILY_DIR/${DATE_YESTERDAY}.json"

# 使用 Node.js 脚本抓取
node scripts/fetch-reports.js "$DATE_YESTERDAY" > "$REPORTS_JSON" 2>/dev/null || {
    log "警告: 抓取失败，生成空数据"
    echo '{"date": "'$DATE_YESTERDAY'", "reports": []}' > "$REPORTS_JSON"
}

REPORT_COUNT=$(node -e "const d=require('$REPORTS_JSON'); console.log(d.reports?.length || 0)" 2>/dev/null || echo "0")
log "发现 $REPORT_COUNT 份财报"

# 步骤2: 初始化 CSV (如果不存在)
if [ ! -f "$CSV_FILE" ]; then
    echo "date,company,code,report_type,revenue,net_profit,yoy_growth,highlights,risks,recommendation,source_url,analyzed_at" > "$CSV_FILE"
fi

# 步骤3: 分析每份财报
node scripts/analyze-reports.js "$REPORTS_JSON" "$CSV_FILE"

log "财报分析任务完成"
