# disk-clean v0.7 / v0.8 迭代计划

> ## ✅ v0.7.0 已于 2026-09-11 完成并发布（GitHub + npm 双渠道）
>
> §1 的全部 10 项（v7-1 ~ v7-10）已实施，测试 11 → **12** 套件全绿；详见
> `docs/RELEASE_NOTES-v0.7.0.md` 与 `CHANGELOG.md` 的 `[0.7.0]` 段。
> **§3 的 v0.8 项仍未承诺**，需重新评估后才启动。
> 下表保留各项的原始描述与验收标准，作为已完成工作的记录与复核依据。

> **本文件是 v0.7 及之后的权威计划**，取代此前的口头/报告形式的提案。
> 起点：**v0.6.0 已发布**（2026-09-11，GitHub Releases + npm 双渠道）。
>
> 原始锐评报告（A/B/C 三组编号问题）不在本仓库内，位于
> `D:\zcode-work\disk-clean-评审与迭代计划-v0.5.0.md`。本文件只保留**仍待办**的部分，
> 并补上优先级裁决与验收标准；已修项见 `CHANGELOG.md` 的 `[0.6.0]` 段，**不要重复劳动**。
>
> 变更本计划需回写本文件（与 `docs/GUI-PLAN.md` 同规矩）。

---

## 0. 当前状态基线（2026-09-11）

| 维度 | 状态 |
|---|---|
| 版本 | `lib/version.js` = **0.6.0**（单源，9 个派生源由 `test/version-consistency.js` 守门） |
| 测试 | **11 个套件全绿**（`node test/all.js`），含 `test/safety-gates.js`（23 组断言） |
| 安全 | A1–A7 已全部修复：硬链接拒绝抽样组、安全闸门真单源、整理目标防穿越、`canonKey` 单源、map schema 统一 |
| 渠道 | GitHub v0.6.0（6 资产）+ **npm `latest` = 0.6.0**（双 bin，`npx -y disk-clean mcp` 已验证 12 工具） |
| 工作树 | 干净 |

---

## 1. v0.7「质量周」——按实测重排后的顺序

### 1.0 为什么重排（含实测依据）

原计划（照搬锐评）把**性能**列为第一优先，理由是"上千重复文件要跑 30–50 分钟"。
**实测推翻了该量级**：

| 项 | 锐评说法 | 实测 | 结论 |
|---|---|---|---|
| v7-2 每 victim 一次 PowerShell | 上千文件 ≈ **30–50 分钟** | 单个 **144ms** → 1000 个 ≈ **2.4 分钟** | 夸大 ~15 倍 |
| v7-1 stat 串行 | 全盘数十万文件时"成为纯瓶颈" | 1 万文件 292ms → 并发 71ms（4.1x）；外推 40 万文件**只省约 9 秒** | 方向对，收益被夸大 |

因此重排为：**先修"承诺了却不生效"（对 AI 撒谎）→ 再修接口一致性 → 再补全缺口 → 最后做性能**。
性能仍要做（批量化能把 2.4 分钟压到几秒），但**验收标准改用实测口径**，不再引用虚高数字。

### 1.1 承诺兑现（最高优先：代码在骗调用方）

| # | 位置 | 问题 | 修法（已决策） | 验收 |
|---|---|---|---|---|
| v7-5 | `lib/config.js:13`、`lib/mcp/tools.js:613`、`README.md:198`、`ROADMAP.md:134` | `blacklist` 是**死配置**：只在 `DEFAULT_CONFIG` 里定义、在 MCP 工具描述里被承诺为"强制清理候选"，**没有任何引擎代码读取它**。模型会去设置它并期待生效。`ROADMAP.md:134` 自己写着"预留"，说明从未实现 | **删除**（用户决策）：从 `DEFAULT_CONFIG`、MCP 工具描述、README 命令表移除；ROADMAP 该行标注为"已移除（从未实现）" | `grep -rn "blacklist" lib bin gui` **零命中**；`disk_config` 工具描述不再提及 |
| v7-6 | `lib/config.js:24` vs `lib/audit.js:29` | `retention.auditLines: 5000` 永不生效——`audit.js` 硬编码 `MAX_AUDIT_LINES = 2000` | `audit.js` 惰性读取 config（**不能顶层 require，避免循环依赖**；`config.js` 不依赖 audit，但保持惰性更安全） | 设 `retention.auditLines 50` → 写入 60 条 → `disk-clean audit` 只显示 50 条；`config reset` 后回到 5000 |

### 1.2 接口一致性（同一动作在不同入口行为不同）

| # | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| v7-3 | `bin/disk-clean.js` | rollback 的确认模型与 MCP 不一致（MCP 端需 `confirm:true`）。**注**：`bin/disk-clean.js:610` 的 help 已写 `organize rollback ... (--yes 执行)`，故锐评"rollback 都不要求 --yes"的措辞**至少对 organize 侧存疑——实施前必须先核实实际行为**，不得照措辞盲改 | 先实测 `dedup rollback` 与 `organize rollback` 在有/无 `--yes` 时的真实行为，再统一 | 两个 rollback 在无 `--yes` 时必须只预览不执行；新增断言 |
| v7-4 | `bin/disk-clean.js:292-305` | CLI `clean` 的类型分支缺 `stale-large`，而 MCP 的 `disk_clean` 支持它 | 补分支 + 更新 `--help` | `disk-clean clean stale-large` 能从报告提取候选；`--help` 与 MCP `CLEAN_TYPES` 一致 |

### 1.3 补全缺口

| # | 位置 | 问题 | 修法（已决策） | 验收 |
|---|---|---|---|---|
| v7-9 | `bin/disk-clean.js` | **没有 `drives` 命令**，但 README/文档多处提到盘符信息 | **新增命令**（用户决策）：复用 `fs.statfsSync`，与 GUI `/api/drives`、MCP `disk_drives` 同源 | `disk-clean drives` 输出各盘容量，且与 MCP `disk_drives` 结果一致 |
| v7-8 | `CHANGELOG.md` | 缺 **0.2.0 / 0.3.0 / 0.3.1** 三个版本条目（有 tag 与 Release，无段落记录） | 依据 `git log <prev-tag>..<tag>` 的**真实提交**补写；**不得凭印象编造**，写不出来的就不写 | 每个条目含真实变更点与日期（与 `git log` 对账） |
| v7-10 | `lib/mcp/server.js:136` | `readline.createInterface({input})` 未显式 `setEncoding('utf8')`（锐评标注为**推测**：GBK 管道下中文描述可能乱码） | **先复现**；复现不了不改，只在文件里留一句"已尝试、未复现" | 能复现则修复；不能复现则记录结论 |

### 1.4 性能（做，但验收用实测口径）

| # | 位置 | 问题 | 修法 | 验收（实测口径） |
|---|---|---|---|---|
| v7-1 | `lib/dedup.js:89-97` | 文件 `stat` **串行 await** | 复用 `lib/engine-core.js` 的 `pool` 并发 | 1 万文件基准：串行 292ms → 并发目标 **< 100ms**；40 万文件外推节省约 9 秒。数字写入 Release Notes |
| v7-2 | `lib/dedup.js` `hardlinkGroup()` | **每 victim 单独 `spawnSync` 一次 PowerShell**（实测 144ms/个） | 一次 PowerShell 批处理整组（参考 `clean.js:171` 的批量范式）；**必须保持现有备份/回滚语义**，`safety-gates` 的 A1/A2 断言不得放宽 | 60 文件基准：8470ms → 目标 **< 1000ms**；1000 victim 外推从 2.4 分钟降到秒级。数字写入 Release Notes |

> 性能基准**不放进 `npm test`**（跑 500 个真实硬链接会拖慢并大量churn 文件系统）。
> 沿用仓库既有做法：放独立基准脚本 + 环境变量门控，`npm test` 保持快；
> 测得的改前/改后数字写进 Release Notes。

### 1.5 健壮性

| # | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| v7-7 | `lib/engine-core.js` `movePath()` 跨盘分支 | 跨盘 `copy` 成功、`rm` 失败 → **留下不可见的双份副本**，且重试被 `EXCL`/`existsP` 卡住 | 失败时检测 dst 完整性并明确回报"已复制但源未删" | 只读源目录模拟 rm 失败，断言返回含该措辞且列出 dst 路径 |

### 1.6 明确不做（写在这里，防止被反复提起）

- **不做** npm 发布自动化 —— OTP 无法自动化（本仓库现状：token 存 `NPM_TOKEN` 环境变量 + `.npmrc` 引用）。
- **不做** `B11` 引擎实例化、`app.js` 拆分 —— 归 v0.8（见 §3）。
- **不做** C6「删除 `gui/publish` / `gui/stage` / `gui/shell/obj` 残留」—— 已核实这些目录**全部在 `.gitignore` 中且未被 git 跟踪**，仅是本地构建产物。
- **不做** 回收站 `$I` 全版本兼容矩阵。
- **不做** `blacklist` 功能（用户已决策删除，非实现）。

---

## 2. v0.7 交付物

- CHANGELOG `[0.7.0]` 段 + `docs/RELEASE_NOTES-v0.7.0.md`（Release body 由此文件提供）。
- 性能项必须给出**改前/改后实测数字**（本仓库惯例：不做无数字的性能声明）。
- 为 v7-3 / v7-4 / v7-6 / v7-9 补回归断言（可并入 `test/safety-gates.js` 或新增套件）。
- **双渠道发布**（用户决策）：GitHub Release（exe + 安装器 + SHA256SUMS）+ npm publish，
  并按 v0.6.0 流程做 exe 形态 MCP 端到端验证。

---

## 3. v0.8 草图（**未承诺**，需在 v0.7 收尾后重新评估）

以下各项**投入大、用户无感**，只有在 v0.7 完成且有明确需求时才启动：

| 项 | 内容 | 为什么推迟 |
|---|---|---|
| B11 引擎实例化 | `lib/engine-core.js` 从模块级状态改为 `createEngine()` 实例 | 当前靠 `resetState` + 串行队列掩盖，未出事故；无明确并发需求 |
| MFT 清理管线 | MFT 快照 → 二次遍历校验 → 生成可清理白名单 | 是真实差异点，但需先有引擎实例化铺路 |
| `gui/web/app.js` 拆分 | 单文件 1137 行按 Tab 拆分（保持零依赖） | 纯可维护性，无用户价值 |
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
`bin` 路径的 `./` 前缀与 `repository.url` 缺 `git+` 前缀都会让 npm 每次发布打印
"was cleaned / was normalized" 警告（`bin` 那条连 npm 官方文档示例都会触发，见
[npm/cli#7302](https://github.com/npm/cli/issues/7302)）。`npm publish --dry-run` 现已零警告。

### 为什么曾卡住（留档，避免重犯）

两轮 token 才成功，值得记录**失败特征**：

| 现象 | 原因 |
|---|---|
| `npm whoami` 报 401 | `~/.npmrc` 里的 `_authToken` 早已失效 |
| `whoami`、`owner ls` 通过，但 `npm publish` 返回 **E403** `You may not perform that action with these credentials` | token 只读：`Packages and scopes → Permissions` 未给 **`Read and write (publish and stage)`**（`Read-only`、`No access`、以及 **`stage only`** 全部会在直接发布时给 403，症状完全一样） |
| token 创建页提示"必须选择一个组织" | 把 **Organizations** 区块的 Permissions 改成了非 `No access`；该区块**只管组织成员/团队设置，明确不授予发包权限**，应设为 `No access` |

**能认证 + 能读 + 不能写 = 权限问题，不是凭据问题**——这个组合可以立刻区分两类故障。

> 凭据存放方式：`NPM_TOKEN` 存 User 作用域环境变量，`~/.npmrc` 写
> `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` —— token 不落明文文件。

### 0.4.1 的遗留

npm 上仍存在 `0.4.1`（含 P0）。`latest` 已指向 0.6.0，正常安装不会再被安装到。
如需更彻底可 `npm deprecate disk-clean@0.4.1 "<原因>"`；**非必需**。

---

## 5. 文档事实错误（已全部修正）

| 文件 | 原错误 | 现状 |
|---|---|---|
| `docs/RELEASE_NOTES-v0.6.0.md` §已知问题 | "npm 首发仍未执行" | ✅ 已改为记录 npm 曾停 0.4.1、现已同步 0.6.0 |
| `CHANGELOG.md` | 同上口径 | ✅ 已同步更正 |
| `README.md` / `README.zh-CN.md` | Option B/C 未提示 npm 落后；Option C 对 npm 用户不可用 | ✅ 警告已撤除，补上"0.6.0 之前装过的请升级" |
| `docs/OPTIMIZATION-PLAN.md` | 曾把 npm 首发列为未完成项 | 该文件已是历史归档，无需改；引用时勿当作当前待办 |

---

## 6. 排期

```
v0.6.0 ✅ 已发布（安全冲刺，GitHub + npm 双渠道）
   ↓
v0.7 质量周   1.1 承诺兑现  →  1.2 一致性  →  1.3 补全  →  1.4 性能  →  1.5 健壮性
   ↓
v0.8 架构季   —— 需重新评估后才启动（§3）
```

**若只能做一件事**：做 **v7-5（删掉 blacklist 这个假承诺）**。
它是当前唯一一处**代码主动向调用方（尤其是 AI）承诺了不存在的能力**，
其余问题最多是慢或繁琐，而这一条会让模型基于错误前提做决策。
