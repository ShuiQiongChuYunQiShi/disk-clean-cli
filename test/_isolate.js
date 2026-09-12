// test/_isolate.js — 测试进程的状态目录隔离（T1）
//
// 背景（这不是"测试不够干净"的小事）：
//   15 个套件里曾有 12 个直接读写**用户真实的** ~/.disk-clean/。实际发生过三件事：
//     1) 用户的扫描报告被覆盖成测试临时树的扫描结果；
//     2) 审计日志被污染——审计是安全特性（用于证明"工具到底动过什么"），
//        实测 73% 的记录来自测试；
//     3) 测试文件被真的丢进用户的回收站（实测 totalInBin=15）。
//   也就是说：维护者每跑一次 `npm test`，就用测试数据覆盖用户的工作产物。
//
// 用法：在每个套件的**最顶部**、任何 `require('../lib/...')` 之前写一行：
//     require('./_isolate.js');
//
// 它做的事：
//   - 把 USERPROFILE / HOME 指向一个临时目录，于是 os.homedir() 以及所有基于它的路径
//     （`~/.disk-clean/config.json`、`audit.jsonl`、`report.json`、`approvals/` …）
//     全部落进沙箱；Windows 读 USERPROFILE、POSIX 读 HOME，所以两个都设。
//   - 顺带隔离 LOCALAPPDATA / APPDATA，避免任何按"应用数据目录"定位的代码漏出去。
//   - 在环境里留标记 DSK_TEST_HOME，重复 require 是幂等的。
//   - 进程退出时删除临时目录。
//
// 因为改的是**进程环境本身**，套件里 spawn 子进程时用
// `env: Object.assign({}, process.env)` 就自然继承了隔离，不需要每处单独注入。
//
// 为什么必须写在各套件顶部而不是统一在 test/all.js 里注入：
//   单独运行一个套件调试（`node test/clean-safety.js`）同样不能碰真实状态目录。
//
// 历史备注：cli-and-config / dsh-config / mcp-protocol 三个套件自带隔离实现（早于本模块），
// 保留原样以免动到它们的清理逻辑；新增套件一律用本模块。
// `test/all.js` 里有静态断言要求每个套件都被隔离，所以"忘记加"会在 CI 上失败。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.DSK_TEST_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-test-home-'));
  const local = path.join(home, 'AppData', 'Local');
  const roaming = path.join(home, 'AppData', 'Roaming');
  fs.mkdirSync(local, { recursive: true });
  fs.mkdirSync(roaming, { recursive: true });

  process.env.DSK_TEST_HOME = home;
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  process.env.LOCALAPPDATA = local;
  process.env.APPDATA = roaming;

  // 退出时清理。用同步删除 + 忽略错误：子进程可能仍持有文件句柄，
  // 残留一个临时目录远好于让测试因为清理失败而报错。
  process.on('exit', function () {
    try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
  });
}

module.exports = {
  home: process.env.DSK_TEST_HOME,
  // spawn 子进程时用它构造 env：已包含隔离，且不必让每个套件记住设哪些变量
  env: function () { return Object.assign({}, process.env); },
};
