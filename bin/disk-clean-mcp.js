#!/usr/bin/env node
'use strict';
// bin/disk-clean-mcp.js — disk-clean 的 MCP Server 入口（stdio 传输）。
//
// 用法（任何 MCP 客户端都能接）：
//   node bin/disk-clean-mcp.js
//
// 客户端配置示例（DSH / Claude Desktop / Cursor 通用）：
//   { "mcpServers": { "disk-clean": { "command": "npx", "args": ["-y", "disk-clean", "mcp"] } } }
//   或本地：{ "command": "node", "args": ["<repo>/bin/disk-clean-mcp.js"] }
//
// 纪律：stdout 只允许出现 MCP 协议消息（一行一个 JSON-RPC 对象），
//       任何诊断信息一律走 stderr，否则会破坏协议流。
const { createServer } = require('../lib/mcp/server.js');
const { tools, SERVER_INFO } = require('../lib/mcp/tools.js');

function main() {
  const server = createServer({
    tools: tools(),
    serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
  });
  process.stderr.write('[disk-clean-mcp] ready: ' + SERVER_INFO.name + ' v' + SERVER_INFO.version +
    ' (' + tools().length + ' tools)\n');
  server.start();
}

main();
