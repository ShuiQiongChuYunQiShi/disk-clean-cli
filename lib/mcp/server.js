'use strict';
// lib/mcp/server.js — Minimal MCP (Model Context Protocol) server core.
// Transport: stdio, JSON-RPC 2.0, newline-delimited (per MCP stdio transport spec).
// Zero dependencies. Nothing but protocol messages may be written to stdout — logs go to stderr.
//
// Supported: initialize, notifications/initialized (ignored), ping,
//            tools/list, tools/call.
const readline = require('readline');

const PROTOCOL_VERSION = '2024-11-05';

const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

function createServer(options) {
  const opts = options || {};
  const tools = Array.isArray(opts.tools) ? opts.tools : [];
  const byName = new Map(tools.map(function (t) { return [t.name, t]; }));
  const serverInfo = opts.serverInfo || { name: 'disk-clean', version: '0.0.0' };
  const protocolVersion = opts.protocolVersion || PROTOCOL_VERSION;
  const input = opts.input || process.stdin;
  const output = opts.output || process.stdout;
  const log = opts.log || function (line) { process.stderr.write('[mcp] ' + line + '\n'); };

  let initialized = false;
  let queue = Promise.resolve();   // 引擎有模块级状态：工具调用必须串行，避免并发扫描互相污染
  const logLines = [];

  function send(msg) {
    output.write(JSON.stringify(msg) + '\n');
  }
  function reply(id, result) {
    send({ jsonrpc: '2.0', id: id, result: result });
  }
  function replyError(id, code, message, data) {
    const err = { code: code, message: message };
    if (data !== undefined) err.data = data;
    send({ jsonrpc: '2.0', id: id, error: err });
  }

  function listTools() {
    return tools.map(function (t) {
      const out = {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema || { type: 'object', properties: {}, required: [] },
      };
      // MCP 注解（提示客户端该工具是否只读/破坏性），客户端可据此决定是否弹确认
      if (t.annotations) out.annotations = t.annotations;
      return out;
    });
  }

  async function callTool(params) {
    const name = params && params.name;
    if (!name || typeof name !== 'string') throw { code: ERR.INVALID_PARAMS, message: 'tools/call requires "name"' };
    const tool = byName.get(name);
    if (!tool) throw { code: ERR.INVALID_PARAMS, message: 'unknown tool: ' + name };
    const args = (params && params.arguments) || {};
    if (typeof tool.handler !== 'function') throw { code: ERR.INTERNAL, message: 'tool has no handler: ' + name };
    let value;
    try {
      value = await tool.handler(args);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      return { content: [{ type: 'text', text: 'TOOL_ERROR: ' + msg }], isError: true };
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const res = { content: [{ type: 'text', text: text }] };
    if (value && typeof value === 'object' && value.ok === false) res.isError = true;
    return res;
  }

  async function handle(msg) {
    const isNotification = msg.id === undefined || msg.id === null;
    const method = msg.method;

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return; // notification: no reply
    if (method === 'initialize') {
      initialized = true;
      reply(msg.id, {
        protocolVersion: protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: serverInfo,
      });
      return;
    }
    if (method === 'ping') { reply(msg.id, {}); return; }
    if (method === 'tools/list') { reply(msg.id, { tools: listTools() }); return; }
    if (method === 'tools/call') {
      const p = msg.params || {};
      const id = msg.id;
      queue = queue.then(function () {
        return callTool(p).then(function (result) {
          reply(id, result);
        }).catch(function (e) {
          if (e && typeof e.code === 'number') replyError(id, e.code, e.message);
          else replyError(id, ERR.INTERNAL, e && e.message ? e.message : String(e));
        });
      });
      return;
    }
    if (method === 'resources/list') { reply(msg.id, { resources: [] }); return; }
    if (method === 'prompts/list') { reply(msg.id, { prompts: [] }); return; }
    if (isNotification) return;
    replyError(msg.id, ERR.METHOD_NOT_FOUND, 'method not found: ' + String(method));
  }

  function handleLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (e) {
      replyError(null, ERR.PARSE, 'parse error: ' + (e && e.message ? e.message : String(e)));
      return;
    }
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      replyError(msg && msg.id !== undefined ? msg.id : null, ERR.INVALID_REQUEST, 'invalid JSON-RPC 2.0 request');
      return;
    }
    Promise.resolve()
      .then(function () { return handle(msg); })
      .catch(function (e) {
        if (msg.id !== undefined && msg.id !== null) replyError(msg.id, ERR.INTERNAL, e && e.message ? e.message : String(e));
      });
  }

  function start() {
    const rl = readline.createInterface({ input: input, crlfDelay: Infinity });
    rl.on('line', handleLine);
    rl.on('close', function () { log('input closed, exiting'); process.exit(0); });
    return rl;
  }

  return {
    start: start,
    handleLine: handleLine,   // exposed for tests
    listTools: listTools,
    callTool: callTool,
    get initialized() { return initialized; },
  };
}

module.exports = { createServer, PROTOCOL_VERSION, ERR };
