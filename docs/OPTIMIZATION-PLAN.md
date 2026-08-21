# disk-clean v0.4 优化计划（按阶段开发）

> 状态：**待执行** ｜ 版本目标：v0.4.0 ｜ 制定日期：2026-08-21
> 原则：**先架构止血 → 再功能增强 → 再工程固化 → 最后回归发布**。每阶段独立可交付、可验收、可回滚。
> 关联文档：`docs/RELEASE-PLAYBOOK.md`（制作/发布 SOP）、`docs/PROCESS-REVIEW.md`（G1–G47 错误清单）、`docs/GUI-PLAN.md`（GUI 设计）。
> 本计划文件是权威路线图；技能（SKILL.md）只做索引指针，不复制本文件内容。

---

## 0. 现状基线（为什么需要这份计划）

| 维度 | 现状 | 问题 |
|---|---|---|
| 代码架构 | 同一套引擎逻辑存在两份：`lib/engine.js`（桌面 CLI/SEA）+ `plugins/dsk-helper.js`（DSH 插件） | **双份改**：规则表、阈值、垃圾判定、查重逻辑各自维护，漏一处就"插件有/桌面没有"；本轮 fallback 查重、junk 路径、健康增强已在两边各改一遍 |
| UI 信息架构 | 主页报告区 4 Tab（v0.3.2 新增）与左侧高级 8 Tab 功能重叠、渲染逻辑各自独立 | 两套导航割裂：用户扫描后在主页看结果，要跳左侧高级页找整理/去重/健康；重复的 DOM 构建函数两处维护 |
| 健康页 | 单次快照（温度/寿命/错误数） | 无趋势：磁盘故障最有价值的信息是"随时间变化"，当前看不到 |
| 重复文件 | 扫描期查重（快但可能空）+ 高级·去重（深度全盘）两个入口 | 用户困惑"主页说没有、去重页却有"；桌面版主页 Tab 只有跳转链接，未内嵌深度查重 |
| 安全 | 删除=移入回收站+审批+审计；serve.js 已有 restorePoint 钩子 | 还原点钩子未接 UI；无"回收站定向恢复"入口 |
| 发布链路 | bump/push/release 均为手工步骤 | G46（PS 编码毁文件）、G47（checkout 抹掉好改动）、代理坑（127.0.0.1:7890 挂了 push 就废）都是手工操作踩出来的 |
| 文档/技能 | 桌面版与插件文档各写各的，SYNC 靠习惯 | 文档漂移开始出现（RELEASE-PLAYBOOK §3.5 未跟上 rep-tabs）；缺少"每轮改动→更新点"的强制清单 |

---

## 阶段一：代码架构 —— 规则单源（止血，最高优先）

**目标**：终结"双份改"。让规则表/阈值/分类映射成为**单一来源**，`lib/engine.js` 与 `plugins/dsk-helper.js` 都引用它。
**策略**：选方向 B（只抽规则表，不合并整个引擎）。理由：合并整个引擎风险大（SEA 打包、插件 require 路径、行为回归），抽规则表改动面最小、收益立即兑现。

### 任务清单

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 1.1 | **盘点差异**：diff 两份引擎，列出所有规则表/阈值/函数清单（EXT_CAT、JUNK_RULES、USER_ZONE_SEGS、APP_ZONE_SEGS、AUTO_SKIP、PROG_NAME_HINTS、PROG_EXT、PROG_DIR_HINTS、ORG_CAT_MAP、DIR_CAT_RULES、DUP_* 阈值、STALE_MS、LOOSE_MIN/LOOSE_MS、MAX_DEPTH、TEMP_SEG 等） | `lib/engine.js` vs `plugins/dsk-helper.js` | 输出一份"差异对照表"落盘 `docs/RULES-DIFF.md`，标出哪些一致、哪些漂移 |
| 1.2 | **创建 `lib/rules.js`**：export 上述全部规则表与阈值常量（只读对象，`Object.freeze` 顶层） | 新建 `lib/rules.js` | `node -e "require('./lib/rules.js')"` 无报错；与两份引擎当前值逐项一致 |
| 1.3 | **桌面引擎改为引用**：`lib/engine.js` 顶部 `const R = require('./rules.js')`，删除本地重复定义 | `lib/engine.js` | `node --check` 过；`node bin/disk-clean.js scan <test> --suggest --json` 与改造前输出逐字段一致 |
| 1.4 | **插件引擎引用**：`plugins/dsk-helper.js` 引用规则。**路径决策**（关键）：插件是独立 node 子进程，可用相对 require；但插件会被复制到三处（product/install/repo），rules.js 也要随三处同步。**推荐做法**：插件目录放一份 `plugins/dsk-rules.js`（由同步脚本从 `lib/rules.js` 生成/复制），dsk-helper.js `require('./dsk-rules.js')` | `plugins/dsk-helper.js`、新建 `plugins/dsk-rules.js` | 插件扫描输出与桌面版对同一测试树完全一致 |
| 1.5 | **同步脚本固化**：`scripts/sync-rules.ps1`（或并入既有同步流程）：`lib/rules.js` → `plugins/dsk-rules.js` 复制 + MD5 校验 + 三处同步（product/install/repo） | 新建 `scripts/sync-rules.ps1` | 改一条规则 → 跑脚本 → 两边 + 三处全部更新，MD5 一致 |
| 1.6 | **行为回归**：同一测试树（含重复/垃圾/散落目录）分别用桌面引擎与插件引擎扫描，diff JSON | 测试脚本/手动 | `summary/category/junk/suggestions` 完全一致（时间戳除外） |

**工作量**：M（1-2 天） ｜ **风险**：低-中（require 路径、SEA 打包内 `lib/rules.js` 会被 esbuild 正常 bundle）｜ **依赖**：无
**里程碑**：改一条规则只改一处 + 双端回归一致。

---

## 阶段二：UI 架构 —— 导航统一 + 渲染复用（中等优先）

**目标**：消灭"主页报告 Tab 与高级 8 Tab"两套重复 UI 的维护面，明确各自定位。
**定位决策**（建议，执行前与用户确认一次）：
- **主页报告 Tab = 行动面板**：只读概览 + 一键动作（清理/查重入口/整理入口），默认呈现"现在该做什么"
- **高级 Tab = 深度分析**：组织/去重/配额/MFT/健康/计划/配置/审计的完整工具

### 任务清单

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 2.1 | **渲染函数复用盘点**：grep 找出 `gui/web/app.js` 中主页报告渲染与高级页渲染的重复构建函数（card/item-list/gauge/table/confirm 流程） | `gui/web/app.js` | 输出复用清单（哪些函数两处调用、哪些重复定义） |
| 2.2 | **抽取 `gui/web/ui-kit.js`**：通用 DOM 构建器（`card()`、`itemList()`、`gauge()`、`badge()`、`statCard()`、`confirm2()` 双确认流程），主页与高级页共用；`index.html` 引入该文件 | 新建 `gui/web/ui-kit.js`、`gui/web/index.html`、`gui/web/app.js` | 首页与高级页渲染结果与重构前视觉一致（headless DOM 对比）；无重复函数（grep 计数下降） |
| 2.3 | **双向跳转**：主页报告 Tab 卡片动作 ↔ 高级页互跳（已有单向：卡片→switchView；补高级页"回到报告"按钮） | `gui/web/app.js` | 双向可达，路径记忆（从清理中心跳到整理页后返回仍停在清理中心） |
| 2.4 | **插件面板对齐**：DSH 插件 `client.js` 的 5 Tab 定位与桌面版一致（概览/清理/重复/整理/健康），确认无第三套重复（插件面板是 React，桌面是原生 DOM，不做代码级复用，只对齐**信息架构与文案**） | `plugins/disk-analyzer/client.js` | 两边的 Tab 名称/顺序/动作语义一致 |

**工作量**：L（2-3 天）｜ **风险**：中（重构渲染可能引入视觉回归；需 headless 对比）｜ **依赖**：阶段一（避免在漂移代码上重构）
**里程碑**：任一 UI 改动只改一处；主页/高级页导航心智清晰。

---

## 阶段三：功能增强（按价值排序，各自独立可交付）

### 3.1 健康趋势（最高价值/最低成本）

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 3.1.1 | `lib/health.js` 追加历史：`check()` 成功后把快照 `{ts, name, temp, wear, errors(read+write uncorr), poh}` 追加到 `~/.disk-clean/health-history.json`（按盘名分组，每组上限 100 条，超出丢弃最旧） | `lib/health.js` | 连续 2 次 check 后历史文件含 2 条；重启进程不丢 |
| 3.1.2 | `/api/health-check` 返回 `trend: {name: [{ts,temp,wear,err}...]}` | `lib/serve.js` | API 响应含 trend 字段 |
| 3.1.3 | 健康页画迷你趋势：每盘温度/寿命/错误数三条 SVG polyline（手写、零依赖，时间跨度=历史条数） | `gui/web/app.js`、`gui/web/ui-kit.js`、`gui/web/style.css` | headless 渲染含 `<svg>` 趋势元素；空历史时优雅降级为"—" |
| 3.1.4 | （插件对齐）`host.js` doHealth 同样落历史文件 + RPC 返回 trend | `plugins/disk-analyzer/host.js`、`plugins/disk-analyzer/host.static5.js` | 插件健康 Tab 出现趋势 |

**工作量**：S-M（1 天）｜ **风险**：低

### 3.2 重复文件入口统一：主页内嵌深度查重

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 3.2.1 | 桌面主页"重复文件"Tab：内嵌「深度全盘查重」按钮（调 `/api/dedup {roots: lastScanRoots}`，进行中显示 loading + 进度文案，完成就地渲染分组表） | `gui/web/app.js` | 主页 Tab 内完成 快速查重说明 → 深度查重 → 结果分组 → 硬链接/回收站动作全流程，无需跳高级页 |
| 3.2.2 | 明确文案区分：快速查重（用户区+浅层，扫描期自动）vs 深度查重（全盘哈希，需数分钟） | `gui/web/app.js`（i18n zh/en） | 文案无歧义 |
| 3.2.3 | 深度结果动作：硬链接合并（走 `/api/dedup {hardlink:true}`，确认弹窗）+ 全部移入回收站（走 `/api/clean {type:'duplicates'}`，但注意**深度结果不在扫描建议白名单**——需在 serve.js 增加"按传入组校验"的 duplicates 变体或标注仅支持硬链接，二选一，执行前确认） | `lib/serve.js`、`gui/web/app.js` | 动作可用且安全（不可越权删除白名单外路径） |
| 3.2.4 | 插件面板对齐：已有深度查重（上一轮完成），只需确认文案与桌面一致 | `plugins/disk-analyzer/client.js` | — |

**工作量**：M（1 天）｜ **风险**：中（3.2.3 的校验变体涉及安全模型，需谨慎设计）

### 3.3 文件年龄分布（免费功能感）

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 3.3.1 | 概览 Tab 加「文件年龄分布」横条：`report.timeBuckets.modified`（年份→字节数，引擎已有）渲染为水平条（年份×字节占比） | `gui/web/app.js`、`gui/web/ui-kit.js` | 扫描后概览 Tab 出现年份分布；无 timeBuckets（旧报告）时隐藏 |
| 3.3.2 | 插件面板概览对齐（可选） | `plugins/disk-analyzer/client.js` | — |

**工作量**：S（0.5 天）｜ **风险**：低

### 3.4 安全闭环：还原点 + 回收站定向恢复

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 3.4.1 | **清理前还原点 UI**：`serve.js` 已有 `body.restorePoint && !dryRun` 钩子（调 `restoreLib.create`），前端确认弹窗加「创建还原点（默认勾选）」；审计记录还原点 id | `gui/web/app.js`、`lib/serve.js`（确认钩子完整） | 清理弹窗可见还原点选项；审计日志含还原点 id |
| 3.4.2 | **还原点入口**：配置/审计页列出最近还原点 + 「恢复」按钮（调 `restoreLib` 现有能力，确认 API 形态后接线） | `gui/web/app.js`、`lib/serve.js` | 从 UI 触发一次恢复流程（dryRun 预览→确认） |
| 3.4.3 | **回收站枚举/恢复**（P2，工作量中）：新增 `/api/recycle-list`（枚举 `C:\$Recycle.Bin` 条目，Shell.Application 或解析 `$I/$R` 文件对）与 `/api/recycle-restore`；审计页/清理中心加「回收站恢复」入口 | `lib/` 新模块或 `lib/clean.js`、`lib/serve.js`、`gui/web/app.js` | 列出最近清理项（名称/原路径/时间/大小），勾选可恢复 |
| 3.4.4 | 插件对齐：DSH 审批流已是硬门槛，还原点可后置 | `plugins/disk-analyzer/*` | — |

**工作量**：M-L（2-3 天，3.4.3 大头）｜ **风险**：中（回收站 $I/$R 解析在部分系统差异大；先做 PowerShell Shell.Application 方案验证）

---

## 阶段四：工程固化 —— 发布链路 + 文档同步机制（防复发）

### 4.1 版本 bump 脚本固化

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 4.1.1 | `scripts/bump-version.js <from> <to>`：四源（`bin/disk-clean.js VER`、`lib/serve.js VER`、`DiskCleanUi.csproj Version/FileVersion/InformationalVersion`、`package.json version`）+ `installer/disk-clean-ui.iss MyAppVersion` + `gui/web/index.html verLabel` 一次性替换；Node 读写（UTF-8 无 BOM）；缺失目标时 MISS 报错不静默 | 新建 `scripts/bump-version.js` | `node scripts/bump-version.js 0.3.2 0.4.0` 后 grep 全部版本一致、无 BOM、`node --check` 过 |
| 4.1.2 | 更新 `gui-development` 技能坑 #7：替换必须用此脚本（替代 G46 手工教训） | `plugin/skills/gui-development/SKILL.md` | 技能内容同步三处 |

**工作量**：S（0.5 天）｜ **风险**：低

### 4.2 push 脚本（代理容错）

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 4.2.1 | `scripts/push.ps1`：读取 git 代理配置 → 先带代理 push，失败自动 `-c http.proxy= -c https.proxy=` 直连重试 → 输出结果并 `ls-remote` 校验本地=远端 | 新建 `scripts/push.ps1` | 代理挂/不挂两种情况都能 push 成功并校验 |

**工作量**：S（0.5 天）｜ **风险**：低

### 4.3 Release 发布脚本

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 4.3.1 | `scripts/publish-release.ps1 <ver>`：`git tag` + push tag → `gh release create`（非 draft，notes 从 `docs/RELEASE-NOTES-<ver>.md` 读）→ 5 资产后台上传（`--clobber`）→ API 校验 draft=false → 下载 setup+引擎 sha 双向核对 → 重算 `dist/SHA256SUMS.txt` | 新建 `scripts/publish-release.ps1` | 一条命令完成 v0.4.0 发布全流程，末位输出校验 MATCH=True |
| 4.3.2 | 与 `github-release-publish` 技能互相引用（技能=指针，脚本=执行） | `plugin/skills/github-release-publish/SKILL.md` | 技能文档说明"直接跑脚本即可" |

**工作量**：M（1 天）｜ **风险**：中（gh token、后台任务、超时处理需按 v0.3.1 发布经验实现）

### 4.4 文档/技能同步机制

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| 4.4.1 | 新建 `docs/SYNC-CHECKLIST.md`：每轮功能/修复改动必须更新的位置清单——①`lib/`（桌面引擎）②`plugins/`（插件引擎/面板）③`gui/web/`（桌面 UI）④`docs/RELEASE-PLAYBOOK.md` ⑤`docs/PROCESS-REVIEW.md` ⑥`plugin/skills/*`（全局技能）⑦三处同步（product/install/repo）⑧MD5 校验 ⑨commit+push | 新建 `docs/SYNC-CHECKLIST.md` | 本计划每阶段收尾时逐项打勾 |
| 4.4.2 | RELEASE-PLAYBOOK §3.5 补 v0.3.2 桌面改动（rep-tabs/清理中心/健康增强/查重 fallback）+ 引用本计划 | `docs/RELEASE-PLAYBOOK.md` | 文档与实际代码一致 |
| 4.4.3 | 技能指针更新：`gui-development`/`dsh-plugin-creation`/`release-sop` 引用本计划文件路径 | 三份 SKILL.md | 技能三处同步 MD5 一致 |

**工作量**：S（0.5 天）｜ **风险**：低

---

## 阶段五：回归、发布与收尾

| # | 任务 | 验收 |
|---|---|---|
| 5.1 | **全量回归矩阵**（每阶段后执行增量，最后全量）：CLI 全命令、API 矩阵（drives/scan/cancel/clean×4/organize plan-apply-rollback/dedup scan-hardlink-rollback/health/mftscan/quota/schedule/config/audit）、真机扫描（D 盘全量，三重断言：roots==所选 / totalBytes≤容量 / categorySum==totalBytes） | 全绿；数据一致性断言 0 差 |
| 5.2 | **双端一致性回归**：桌面 SEA vs 插件引擎同一测试树输出 diff | 完全一致（阶段一后每轮保持） |
| 5.3 | **headless DOM 回归**：主页 4 Tab 渲染、健康趋势 SVG、无 JS 错误 | `--headless=new` + 独立 user-data-dir；`Uncaught|ReferenceError|TypeError` 为零 |
| 5.4 | **静默安装 + 启动验证**：安装 exit=0 → 引擎版本 → 健康 → 页面 200 | 全过 |
| 5.5 | **版本 bump → 构建 → 发布**：`bump-version.js` → `build-installer.ps1` → `publish-release.ps1` | 发布链路一次成功；GitHub 下载 sha 双向 MATCH |
| 5.6 | **复盘更新**：PROCESS-REVIEW 补本轮新坑（预计 G48+）；SYNC-CHECKLIST 全勾 | 文档与代码一致 |
| 5.7 | **三处同步 + 提交推送**：MD5 校验 + `push.ps1` | local=remote |

---

## 总体依赖与顺序

```
阶段一（规则单源）  ← 一切功能改动的地基，先做
   ↓
阶段二（UI 架构）   ← 依赖阶段一（不在漂移代码上重构）
   ↓
阶段三（功能增强）  ← 3.1 健康趋势 可并行于 3.2/3.3；3.4 安全闭环独立
   ↓
阶段四（工程固化）  ← 4.1-4.3 工具脚本可在阶段三期间并行开发；4.4 每阶段收尾执行
   ↓
阶段五（回归发布）  ← v0.4.0 发布
```

## 优先级裁决（如只做一半）

- **必做**：阶段一（止血）+ 阶段四 4.1/4.2（bump/push 脚本，防再次踩 G46/G47/代理坑）
- **强烈建议**：阶段三 3.1（健康趋势，性价比最高）
- **可选**：阶段二（UI 重构，收益长线但风险中）、阶段三 3.4（安全闭环，工作量最大）

## 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 规则单源后 SEA 打包或插件 require 路径异常 | 中 | 阶段一 1.6 双端回归兜底；esbuild 正常 bundle lib/rules.js |
| UI 重构视觉回归 | 中 | headless 前后 DOM 对比；ui-kit 抽取时保持 class 名不变 |
| 回收站 $I/$R 解析跨系统差异 | 中 | 先 PowerShell Shell.Application 方案，验证后再扩展 |
| 深度查重结果删除越权 | 中 | 3.2.3 二选一决策（仅硬链接 or 新增按组白名单校验），执行前评审 |
| 健康趋势文件无限增长 | 低 | 每组上限 100 条 + 修剪 |
