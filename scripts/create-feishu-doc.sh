#!/bin/bash
# 创建飞书云文档的辅助脚本
# 用法: ./create-feishu-doc.sh <title> <content_file>

set -e

TITLE="$1"
CONTENT_FILE="$2"

if [ -z "$TITLE" ] || [ -z "$CONTENT_FILE" ]; then
    echo "用法: $0 <title> <content_file>"
    exit 1
fi

if [ ! -f "$CONTENT_FILE" ]; then
    echo "错误: 内容文件不存在: $CONTENT_FILE"
    exit 1
fi

# 读取内容
CONTENT=$(cat "$CONTENT_FILE")

# 创建临时 JSON 文件
TEMP_JSON=$(mktemp)
trap "rm -f $TEMP_JSON" EXIT

# 创建文档 (通过调用 Node.js 脚本)
node -e "
const https = require('https');
const fs = require('fs');

const title = process.argv[1];
const content = fs.readFileSync(process.argv[2], 'utf-8');

// 获取飞书 access token
const credentialsPath = process.env.OPENCLAW_CREDENTIALS_PATH || '${HOME}/.openclaw/credentials';
let accessToken = process.env.FEISHU_ACCESS_TOKEN || process.env.FEISHU_TENANT_ACCESS_TOKEN;

if (!accessToken) {
    // 尝试从 OpenClaw 配置获取
    try {
        const config = JSON.parse(fs.readFileSync('${HOME}/.openclaw/config.json', 'utf-8'));
        accessToken = config.feishu?.tenantAccessToken || config.feishu?.accessToken;
    } catch (e) {}
}

if (!accessToken) {
    console.error('错误: 未找到飞书 access token');
    console.error('请设置环境变量 FEISHU_ACCESS_TOKEN 或 FEISHU_TENANT_ACCESS_TOKEN');
    process.exit(1);
}

// 步骤1: 创建文档
const createData = JSON.stringify({ title });

const createReq = https.request({
    hostname: 'open.feishu.cn',
    port: 443,
    path: '/open-apis/docx/v1/documents',
    method: 'POST',
    headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
    },
}, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.code !== 0) {
                console.error('创建文档失败:', json.msg);
                process.exit(1);
            }
            
            const docToken = json.data?.document?.document_id;
            if (!docToken) {
                console.error('创建文档失败: 未获取到 document_id');
                process.exit(1);
            }
            
            // 步骤2: 写入内容
            const writeData = JSON.stringify({
                requests: [{
                    request_type: 'InsertTextRequest',
                    insert_text_request: {
                        text: content,
                        index: 0,
                    }
                }]
            });
            
            const writeReq = https.request({
                hostname: 'open.feishu.cn',
                port: 443,
                path: '/open-apis/docx/v1/documents/' + docToken + '/blocks/' + docToken + '/children/batch_create',
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + accessToken,
                    'Content-Type': 'application/json',
                },
            }, (writeRes) => {
                let writeResult = '';
                writeRes.on('data', chunk => writeResult += chunk);
                writeRes.on('end', () => {
                    const writeJson = JSON.parse(writeResult);
                    const result = {
                        document_id: docToken,
                        url: 'https://feishu.cn/docx/' + docToken,
                        write_success: writeJson.code === 0
                    };
                    console.log(JSON.stringify(result, null, 2));
                });
            });
            
            writeReq.on('error', (e) => {
                console.error('写入内容失败:', e.message);
                console.log(JSON.stringify({ document_id: docToken, url: 'https://feishu.cn/docx/' + docToken, write_success: false }));
            });
            
            writeReq.write(JSON.stringify({ children: [{ text: content }] }));
            writeReq.end();
        } catch (e) {
            console.error('解析响应失败:', e.message);
            process.exit(1);
        }
    });
});

createReq.on('error', (e) => {
    console.error('创建文档请求失败:', e.message);
    process.exit(1);
});

createReq.write(createData);
createReq.end();
" "$TITLE" "$CONTENT_FILE"
