# disk-clean v0.7 / v0.8 迭代计划

> **本文件是 v0.7 及之后的权威计划**，取代此前的口头/报告形式的提案。
> 起点：**v0.6.0 已发布**（2026-09-11，GitHub Releases）。v0.6.0 完成了一次安全冲刺，
> 修复了第三方锐评提出的 1 个 P0 与 6 项安全/正确性缺陷。
>
> 原始锐评报告（88 项编号问题，A/B/C 三组）不在本仓库内，位于
> `D:\zcode-work\disk-clean-评审与迭代计划-v0.5.0.md`。本文件只保留**仍待办**的部分，
> 并补上优先级裁决与验收标准；已修项见 `CHANGELOG.md` 的 `[0.6.0]` 段，**不要重复劳动**。
>
> 变更本计划需回写本文件（与 `docs/GUI-PLAN.md` 同规矩）。

---

## 0. 当前状态基线（2026-09-11）

| 维度 | 状态 |
|---|---|
| 版本 | `lib/version.js` = **0.6.0**（单源，9 个派生源由 `test/version-consistency.js` 守门） |
| 测试 | **11 个套件全绿**（`node test/all.js`），含新增 `test/safety-gates.js`（23 组断言） |
| 安全 | A1–A7 已全部修复：硬链接拒绝抽样组、安全闸门真单源、整理目标防穿越、`canonKey` 单源、map schema 统一 |
| GitHub | v0.6.0 已发布（6 资产，哈希双向核对，CI 绿） |
| **npm** | **`latest` 停在 0.4.1（2026-08-25），含 P0 且无 MCP server** —— 见 §4 |
| 工作树 | 干净 |

### 已核实的两条"文档承诺 vs 代码"落差（本计划已列入 v0.7）

- `config.blacklist`：只存在于 `lib/config.js:13` 的定义与 `lib/mcp/tools.js:613` 的**工具描述**里，
  **任何引擎代码都不读取**。即 MCP 工具向模型承诺了"强制候选"能力，而该能力不存在 —— 模型会去设置它并期待生效。
- `config.retention.auditLines`（默认 5000）：只存在于 `lib/config.js:24`，
  而 `lib/audit.js:28` 把 `MAX_AUDIT_LINES` **硬编码为 2000**。该配置项永不生效。

---

## 1. v0.7「质量周」——只做用户可感知的事

**目标**：把"能用"变成"好用、不骗人"。**不做架构级改造**（那属 v0.8）。
**规模**：预计 3–5 个工作日。**验收总闸**：`node test/all.js` 全绿 + 下述逐项验收通过。

### 1.1 P1 —— 性能（用户能直接感知，优先）

| # | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| v7-1 | `lib/dedup.js:89-97` | 文件 `stat` **串行 await**：`for (const en of files) { st = await fsp.stat(...) }`，全盘数十万文件时成为纯瓶颈 | 复用 `lib/engine-core.js` 的 `pool` 并发（`CONCURRENCY` 已定义为 16） | 造 5,000 文件重复树，记录改前/改后 `dedup scan` 的 `elapsedMs`，改进需 ≥2x 并写入 Release Notes |
| v7-2 | `lib/dedup.js` `hardlinkGroup()` | **每个 victim 单独 `spawnSync` 一次 PowerShell**（`timeout: 30000`）。上千重复文件 ≈ 30–50 分钟 | 一次 PowerShell 批处理整组（`clean.js:171` 已有批量范式可参考） | 500 个重复文件 hardlink 总耗时 **< 60s**（当前约 1s/个）；失败回滚语义保持不变（现有 `safety-gates` 断言不得放宽） |

### 1.2 P1 —— 接口一致性（同一条命令在不同入口行为不同，是隐藏的坑）

| # | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| v7-3 | `bin/disk-clean.js:695` | `dedup rollback`（及 `organize rollback`）**不要求 `--yes`**，而 MCP 端要求 `confirm:true` —— 确认模型不一致，且回滚会重新占用磁盘空间 | 统一要求 `--yes`；不加时输出 dry-run 提示 | `disk-clean dedup rollback`（无 `--yes`）必须只预览不执行；新增断言 |
| v7-4 | `bin/disk-clean.js:292-305` | CLI `clean` 的类型分支只有 `recycle-bin` / `duplicates` / `empty-dirs` / `junk-temp`，**缺 `stale-large`**，而 MCP 的 `disk_clean` 支持它 | 补分支 + 更新 `--help` | `disk-clean clean stale-large` 能从报告自动提取候选；`--help` 与 MCP 的 `CLEAN_TYPES` 一致 |

### 1.3 P1 —— 承诺兑现（要么实现，要么从描述里删掉）

| # | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| v7-5 | `lib/config.js:13` + `lib/mcp/tools.js:613` | `blacklist` 是**死配置**，却在工具描述里被承诺为"强制清理/移动候选" | **二选一**：① 实现（过 `guard` 加入建议候选）② 从 `DEFAULT_CONFIG` 与工具描述中删除 | 若实现：设置 `blacklist` 后 `disk_scan` 建议里出现该项，且**受保护路径仍被拒绝**（安全闸门优先）；若删除：`grep -rn blacklist lib bin` 零命中 |
| v7-6 | `lib/config.js:24` vs `lib/audit.js:28` | `retention.auditLines: 5000` 不生效，实际硬编码 2000 | `audit.js` 读取 config（注意：`audit.js` 不能反向依赖 config 造成循环，用惰性 `require` 或注入） | `config set retention.auditLines 50` 后写入 60 条，`disk-clean audit` 只显示 50 条 |

### 1.4 P2 —— 健壮性

| # | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| v7-7 | `lib/engine-core.js` `movePath()` 跨盘分支 | 跨盘 `copy` 成功、`rm` 失败 → **留下不可见的双份副本**，且重试被 `EXCL`/`existsP` 卡住 | 失败时检测 dst 完整性并明确回报"已复制但源未删" | 只读源目录模拟 rm 失败，断言返回里含该措辞且列出 dst 路径 |

### 1.5 P3 —— 文档债（顺手清）

| # | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| v7-8 | `CHANGELOG.md` | 缺 **0.2.0 / 0.3.0 / 0.3.1** 三个版本条目（有 tag 与 Release，无段落记录） | 依据对应 tag 的提交内容补写；**不得凭印象编造**，写不出来就保留"已知缺口"说明 | 每个条目至少含该版本的真实变更点与发布日期（与 `git log <tag>` 对账） |
| v7-9 | `bin/disk-clean.js` | **没有 `drives` 命令**，但 README/文档多处提到盘符信息 | 二选一：① 加 `drives` 子命令（展示容量，复用 `fs.statfsSync`，与 GUI `/api/drives`、MCP `disk_drives` 同源）② 改文档 | 若加命令：`disk-clean drives` 输出各盘容量，且与 `disk_drives` 工具结果一致 |
| v7-10 | `lib/mcp/server.js:136` | `readline.createInterface({input})` 未显式 `setEncoding('utf8')`（评审标注为*推测*：GBK 管道下中文描述可能乱码） | 先复现；**复现不了就不改**，只在文件里留一句说明 | 若复现：UTF-8 声明后修复；若不能复现，写清"已尝试、未复现"以免后人重复排查 |

### 1.6 明确不做（写在这里，防止被反复提起）

- **不做** npm 发布自动化 —— OTP 无法自动化，属一次性人工动作。
- **不做** `B11` 引擎实例化、`app.js` 拆分 —— 归 v0.8（见 §3）。
- **不做** C6「删除 `gui/publish` / `gui/stage` / `gui/shell/obj` 残留」—— 已核实这些目录**全部在 `.gitignore` 中且未被 git 跟踪**，仅是本地构建产物，无需处理。
- **不做** 回收站 `$I` 全版本兼容矩阵 —— 当前"仅恢复本工具清理项"已规避大部分风险。

---

## 2. v0.7 交付物

- CHANGELOG `[0.7.0]` 段 + `docs/RELEASE_NOTES-v0.7.0.md`（Release body 由此文件提供）。
- 性能项必须给出**改前/改后实测数字**（本仓库惯例：不做无数字的性能声明）。
- 至少为 v7-3 / v7-4 / v7-7 补回归断言（可加进 `test/safety-gates.js` 或新增套件）。
- 若 v7-5 选择"删除 blacklist"，需同步 `lib/mcp/tools.js:613` 的工具描述。

---

## 3. v0.8 草图（**未承诺**，需在 v0.7 收尾后重新评估）

以下各项**投入大、用户无感**，只有在 v0.7 完成且有明确需求时才启动：

| 项 | 内容 | 为什么推迟 |
|---|---|---|
| B11 引擎实例化 | `lib/engine-core.js` 从模块级状态改为 `createEngine()` 实例 | 当前靠 `resetState` + 串行队列掩盖，实际未出事故；无明确并发需求 |
| MFT 清理管线 | MFT 快照 → 二次遍历校验 → 生成可清理白名单 | 是真实差异点，但需先有 v0.8 的引擎实例化铺路 |
| `gui/web/app.js` 拆分 | 单文件 1137 行按 Tab 拆分（保持零依赖） | 纯可维护性，不破出货形态，无用户价值 |
| OneDrive 精确属性检测 | 从路径段判断升级为真实占位/在线属性检测 | 当前按段判断已能规避主要风险 |
| scan 报告内嵌 health 摘要 | 复用 `healthCache` | 低价值，优先级最低 |

---

## 4. npm 渠道 —— ✅ 已于 2026-09-11 解决

**结论**：`disk-clean@0.6.0` 已发布，`dist-tags.latest` 从 0.4.1 更新为 0.6.0。

验证记录（发布后实测）：

| 检查 | 结果 |
|---|---|
| `registry.npmjs.org/disk-clean` → `dist-tags.latest` | `0.6.0` |
| 已发布版本 | `0.4.1, 0.6.0` |
| 0.6.0 的 `bin` | `{disk-clean, disk-clean-mcp}` 两个都在 |
| `npx -y disk-clean --version` | `disk-clean v0.6.0` |
| **`npx -y disk-clean mcp`** | ✅ 起来并返回 **12 个工具**（README Option C 从此对 npm 用户成立） |
| 发布前闸门 | `prepublishOnly` → `node test/all.js` **11/11 passed** |

**发布时发现并修掉的两个 npm 噪音**（`package.json`，commit `253096b`）：
`bin` 路径的 `./` 前缀与 `repository.url` 缺 `git+` 前缀都会让 npm 在每次发布时打印
"was cleaned / was normalized" 警告（`bin` 那条连 npm 官方文档的示例都会触发，见
[npm/cli#7302](https://github.com/npm/cli/issues/7302)）。`npm publish --dry-run` 现已零警告。

### 为什么曾卡住（留档，避免重犯）

两轮 token 才成功，值得记录**失败特征**：

| 现象 | 原因 |
|---|---|
| `npm whoami` 报 401 | `~/.npmrc` 里的 `_authToken` 早已失效 |
| `whoami`、`owner ls` 通过，但 `npm publish` 返回 **E403** `You may not perform that action with these credentials` | token 只读：`Packages and scopes → Permissions` 未给 **`Read and write (publish and stage)`**（`Read-only`、`No access`、以及**`stage only`** 全部会在直接发布时给 403，症状完全一样） |
| token 创建页提示"必须选择一个组织" | 把 **Organizations** 区块的 Permissions 改成了非 `No access`；该区块**只管组织成员/团队设置，明确不授予发包权限**，应设为 `No access` |

**能认证 + 能读 + 不能写 = 权限问题，不是凭据问题**——这个组合可以立刻区分两类故障。

> 凭据存放方式（本次采用）：`NPM_TOKEN` 存 User 作用域环境变量，`~/.npmrc` 写
> `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` —— token 不落明文文件。

### 0.4.1 的遗留

npm 上仍存在 `0.4.1`（含 P0）。`latest` 已指向 0.6.0，正常情况下不会再被安装。
如需更彻底，可执行 `npm deprecate disk-clean@0.4.1 "<原因>"` 让显式指定该版本安装时收到警告；
**非必需**。

---

## 5. 文档事实错误（已全部修正）

| 文件 | 原错误 | 现状 |
|---|---|---|
| `docs/RELEASE_NOTES-v0.6.0.md` §已知问题 | "npm 首发仍未执行" | ✅ 已改为记录 npm 曾停 0.4.1、现已同步 0.6.0 |
| `CHANGELOG.md` | 同上口径 | ✅ 已同步更正 |
| `README.md` / `README.zh-CN.md` | Option B/C 未提示 npm 落后；Option C 对 npm 用户不可用 | ✅ 警告已撤除，并补上"0.6.0 之前装过的请升级" |
| `docs/OPTIMIZATION-PLAN.md` | 曾把 npm 首发列为未完成项 | 该文件已是历史归档，无需改；引用时勿当作当前待办 |

---

## 6. 排期建议

```
v0.6.0 ✅ 已发布（安全冲刺，GitHub + npm 双渠道）
   ↓
v0.7 质量周   —— 1.1 性能 → 1.2 一致性 → 1.3 承诺兑现 → 1.4 健壮性 → 1.5 文档债
   ↓
v0.8 架构季   —— 需重新评估后才启动（§3）
```

**若只能做一件事**：做 **v7-1 + v7-2（性能）**。上千重复文件的去重当前要跑 30–50 分钟，
这是用户唯一会主动抱怨的点；其余都是"不骗人"层面的改进。
