# 规则差异对照表（lib/engine.js vs plugins/dsk-helper.js）

> 生成日期：2026-08-21 ｜ 阶段一 1.1 产物
> 结论：核心规则表 100% 一致，仅头部注释与参数解析方式不同；已抽取为 `lib/rules.js` 单一来源。

## 1. 常量/规则表对比

| 规则 | lib/engine.js | plugins/dsk-helper.js | 差异 | 处理 |
|---|---|---|---|---|
| DAYS | `24*3600*1000` | 同 | 无 | 抽至 rules.js |
| STALE_MS | `730*DAYS` (let) | 同 (const) | let vs const | 统一为 DEFAULTS.STALE_MS，引擎侧 let 可覆盖 |
| STALE_LARGE_MIN | `500*1024*1024` (let) | 同 (const) | 同上 | DEFAULTS |
| DUP_MIN_SIZE | `1<<20` (let) | 同 (const) | 同上 | DEFAULTS |
| DUP_FULL_LIMIT | `32*1024*1024` | 同 | 无 | rules.js |
| DUP_HEAD/TAIL | `64*1024` | 同 | 无 | rules.js |
| WIDE_MAX_FILES/BYTES | `20000` / `1G` | 同 | 无 | rules.js (v0.3.2 fallback 新增) |
| LOOSE_MS/MIN | `30*DAYS` / `100MB` (let) | 同 (const) | let vs const | DEFAULTS |
| LOOSE_MAX | `100` | 同 | 无 | rules.js |
| MAX_DEPTH/CONCURRENCY | `64` / `64` | 同 | 无 | rules.js |
| EXT_CAT | 55 行完整表 | 同 | 无 | rules.js |
| EXT_JUNK | 同 | 同 | 无 | rules.js |
| DIR_CAT_RULES | 同 | 同 | 无 | rules.js |
| JUNK_RULES | 同 | 同 | 无 | rules.js |
| AUTO_SKIP | `['system volume information']` | 同 | 无 | rules.js |
| USER_ZONE_SEGS | 同 | 同 | 无 | rules.js |
| APP_ZONE_SEGS | 同 | 同 | 无 | rules.js |
| DRIVE_ROOT_SKIP | 同 | 同 | 无 | rules.js |
| PROG_NAME_HINTS | 100+ 项 | 同 | 无 | rules.js |
| PROG_DIR_HINTS | 同 | 同 | 无 | rules.js |
| PROG_EXT | 同 | 同 | 无 | rules.js |
| ORG_CAT_MAP | 同 | 同 | 无 | rules.js |

## 2. 结构差异（非规则）

| 维度 | lib/engine.js | plugins/dsk-helper.js |
|---|---|---|
| 形态 | 模块（`module.exports.run` + 直接执行 `node engine.js --roots`） | 脚本（直接执行 `node dsk-helper.js --roots`） |
| 参数解析 | 顶层 `let args/roots/excludes` + `resetState()` 重置 | 顶层 `const args/roots` 仅一次 |
| 阈值可覆盖 | `run()` 开头读配置文件覆盖 `let STALE_MS` 等 | 不可覆盖（const 写死） |
| 调用方 | `bin/disk-clean.js` / `lib/serve.js` spawn `node lib/engine.js` | `host.static5.js` spawn `node plugins/dsk-helper.js` |

> 阈值可覆盖差异已保留：`lib/rules.js` 导出 `DEFAULTS`，引擎侧用 `let X = Rules.DEFAULTS.X` 保持可覆盖语义；插件侧直接 `const X = Rules.DEFAULTS.X`（无需覆盖）。

## 3. 抽取后验证

- `node --check lib/rules.js / lib/engine.js / plugins/dsk-helper.js` 全过
- 同一测试树（D:\dsk-rule-test 含重复文件）双端 `summary.dupScan` / `suggestions` 完全一致（见 1.6 回归）
- `scripts/sync-rules.ps1` 一键同步 product/install/repo 三处，MD5 一致

## 4. 后续维护

- 改规则只需改 `lib/rules.js`，然后 `powershell -File scripts/sync-rules.ps1`
- 新增规则表项时同步更新本对照表
