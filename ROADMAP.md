# disk-clean-cli — 开发路线图（ROADMAP）

> 目标：将 DSH 插件形态的磁盘清理与分析引擎，演进为**可发布 GitHub、可独立使用**的开源 CLI 工具。
> 定位：Windows 磁盘扫描 / 分类 / 智能建议 / 安全清理 / 目录整理（含快捷方式修复）。
> 差异化卖点：① 快捷方式自动修复+可回滚（业界首创）② 审计日志+完整回滚 ③ Markdown 可读报告 ④ AI 可选集成。

---

## 0. 总体策略

- **独立仓库**：`disk-clean-cli`（本目录），与 DSH 插件仓库分开，互相链接。
- **零 npm 运行时依赖**：引擎使用 Node 内置模块 + PowerShell（仅快捷方式 COM 修复需要），保证 `pkg` 打包后单文件 exe 可跑。
- **安全默认**：所有破坏性操作默认 `--dry-run`，必须显式 `--yes` 才执行；目录移动写 undo 映射可回滚。
- **输出双格式**：JSON（机器可读）+ Markdown（人类可读），为 AI 集成与报告渲染留接口。
- **分阶段**：P0 先让"有人愿意试"，P1 补可用性，P2 补场景，P3 补保险与国际化。每阶段有明确验收标准，完成再进下一阶段。

---

## 1. 阶段总览（对应"可优化空间"全部 10 项）

| 阶段 | 内容 | 对应优化项 | 状态 |
|---|---|---|---|
| Phase 0 | 仓库初始化 + 本计划 | — | ✅ 完成 |
| Phase 1 | 独立 CLI（子命令、零依赖、安全默认） | 优化① 独立 CLI | ✅ 完成 |
| Phase 2 | 单文件 EXE 打包 + 演示素材 | 优化① 单文件 EXE | ✅ 完成 |
| Phase 3 | 英文 README + MIT + CI + 发布 | 优化② 英文 README/截图/demo | 🔄 进行中 |
| Phase 4 | 规则配置文件（白/黑名单、阈值、保留策略） | 优化④ | ⬜ |
| Phase 5 | 定时任务（schtasks 注册 + 报告归档） | 优化⑤ | ⬜ |
| Phase 6 | MFT 直读快速扫描（WizTree 思路） | 优化③ | ⬜ |
| Phase 7 | SMART / SSD 健康检查 | 优化⑥ | ⬜ |
| Phase 8 | 全盘哈希 dedup（指纹+硬链接去重） | 优化⑦ | ⬜ |
| Phase 9 | 每用户/每目录配额分析 | 优化⑧ | ⬜ |
| Phase 10 | 移动前自动建系统还原点 | 优化⑨ | ⬜ |
| Phase 11 | i18n 多语言（报告模板可扩展） | 优化⑩ | ⬜ |
| Phase 12 | 最终验证 + GitHub 发布 | — | ⬜ |

---

## 2. Phase 0 — 仓库初始化

- [x] 建目录结构：`bin/ lib/ docs/ test/ .github/workflows/`
- [x] 本 ROADMAP.md
- [ ] `package.json`（name/version/bin/license MIT/scripts）
- [ ] `.gitignore`（node_modules、*.exe、测试产物）
- [ ] 引擎入仓：`dsk-helper.js` → `lib/engine.js`（保持行为不变）

**验收**：`node bin/disk-clean.js --help` 能输出用法。

---

## 3. Phase 1 — 独立 CLI（优化① 独立 CLI）

### 3.1 子命令设计

```
disk-clean <command> [options]

Commands:
  scan [roots]          扫描磁盘/目录，生成报告（JSON + Markdown）
  report <file>         读取已有报告，重新渲染（JSON→Markdown / 终端摘要）
  organize plan|apply|rollback   目录整理（含 includeProgram / fixShortcuts）
  clean                 垃圾清理（回收站/临时文件/空目录/重复文件）
  fix-shortcuts         单独修复指向旧路径的快捷方式
  audit                 查看审计日志
  config                查看/编辑规则配置文件（Phase 4 启用）
  schedule              定时任务管理（Phase 5 启用）
  health                SMART/SSD 健康（Phase 7 启用）
  quota                 每用户配额分析（Phase 9 启用）
```

### 3.2 安全默认（所有破坏性命令）

- 默认 `--dry-run`：只输出将要执行的操作 + 预估释放空间，不真正执行。
- 必须 `--yes` 才执行。
- 每次实际执行写审计日志 `~/.disk-clean/audit.jsonl`（时间/类型/路径/结果）。
- 目录移动写 undo 映射 `~/.disk-clean/organize-map.json`，`rollback` 可恢复。
- 系统关键目录硬禁止：`\windows\` `\program files*\` `\programdata\` `\winsxs\` `\system volume information\` `\$recycle.bin\`。

### 3.3 实施步骤

1. ✅ 复制 `dsk-helper.js` → `lib/engine.js`，模块化改造：`run(argv)` 可重入、状态可重置、直接执行兼容原输出。
2. ✅ 写 `bin/disk-clean.js`：子命令分发 + 安全默认（无 `--yes` 一律 dry-run 预览）+ 终端人类可读摘要 + 进度轮询。
3. ✅ 输出增强：终端摘要（类别比例条/智能建议/散落候选）+ 报告路径回显 + 自动生成 Markdown。
4. ✅ 错误处理：非零退出码 + stderr 错误信息；audit 审计日志 JSONL。

**Phase 1 已发现并修复的关键 bug：**
- `fsp.mkdir('D:\\', {recursive:true})` 对已存在盘根抛 EPERM → `ensureParent()` 先 stat 已存在则跳过（影响 rollback 到盘根目录）。
- PowerShell `Set-Content -Encoding UTF8` 写 BOM → `readJson` 容忍 BOM。
- 引擎在 moved=0 时仍 push 空回滚记录污染最后一批 → 仅 moved>0 时写 map。
- 移动瞬时锁（Defender 扫描）→ movePath 4 次阶梯重试 + rename 失败 fallback copy。

**验收结果（2026-08-16 实测）：**
- ✅ `node bin/disk-clean.js scan D:\` 全盘扫描 60.4s，报告 JSON+MD 落盘，终端摘要完整。
- ✅ `organize plan --include-program` 输出 12 loose + program 候选（⚠ 标注）。
- ✅ `organize apply --yes`（D:\_dsk_cli_test 隔离测试目录）移动 1/1 → `rollback --yes` 回滚 1/1，目录回原位。
- ✅ `clean` 三类型 dry-run 预览 + 系统目录保守过滤；`audit` 日志展示。
- ✅ 修复已同步回 DSH 插件权威引擎 `dsk-helper.js`（预设 + 产品目录，49,382 B）。

---

## 4. Phase 2 — 单文件 EXE + 演示（优化① 单文件 EXE）

1. ✅ ~~pkg~~ 尝试：`@yao-pkg/pkg` 在 Windows 需 GNU patch + 从源码编译 node（缺 NASM）→ **改用 Node 官方 SEA**（`node:sea` + esbuild bundle + postject，离线可用，零外部二进制下载）。
2. ✅ 单文件 `dist/disk-clean-win-x64.exe`（82 MB，内嵌 node 22 运行时）。
3. ✅ Windows 自测：`--help` / `--version` / `scan`（内部子进程 `--internal-scan` 自我调用，`node:sea.isSea()` 区分环境）。
4. ✅ 演示素材：`docs/demo-scan.txt`（终端输出）+ `docs/demo-report.md`（Markdown 报告样例）。
5. ✅ Release 资产：`scripts/build-sea.ps1`（bundle → blob → 注入 → sha256 + checksums.txt）。

**验收（2026-08-16 实测）**：
- ✅ 纯净 PATH（无 node）下 `dist\disk-clean-win-x64.exe --version` / `scan` 均 exit 0。
- ✅ 已知限制：postject 注入会使 exe 的 Authenticode 数字签名失效（SmartScreen 可能提示"未知发布者"，属 SEA 固有行为，发布时在 Release 说明中提示）。

## 5. Phase 3 — 发布准备（优化② 英文 README/截图/demo）

1. ✅ 英文 README.md（对比表 + 安装 + 快速开始 + 安全模型 + 示例输出）。
2. ⬜ 中文 README.zh-CN.md（可选，低优先级）。
3. ✅ MIT LICENSE。
4. ✅ GitHub Actions `.github/workflows/build.yml`（check + smoke + 构建 exe + Release 资产）。
5. ⬜ `CONTRIBUTING.md` + issues 模板。
6. ⬜ git init + 首次提交（本地仓库就绪）。

**验收**：README 英文可读，CI 全绿，Release 资产完整。

---

## 6. Phase 4 — 规则配置文件（优化④）

- ✅ 配置文件 `~/.disk-clean/config.json`（或 `--config <file>`）：
  - `exclude`：白名单（永不清理/移动，扫描时跳过）
  - `blacklist`：黑名单（预留；CLI clean 自动附加候选）
  - `thresholds`：可调阈值（looseMinBytes/looseMinDays、staleMinBytes/staleMinDays、dupMinBytes）
  - `retention`：保留策略（审计行数、报告份数）
  - `junkRules` / `organizeRules`：自定义规则（配置结构已就绪，引擎接入 v1.1）
- ✅ 引擎读取配置（默认值兜底）：`lib/config.js`（deepMerge 默认）+ engine `run()` 加载覆盖阈值与 exclude。
- ✅ `disk-clean config` 子命令：show / set <json路径> <值> / reset / path。
- ✅ `scan --config <file>` 透传（修 cmdScan 未传 --config 的 bug）。

**验收（2026-08-16 实测）**：
- ✅ `config set thresholds.looseMinBytes 10485760` 后，20MB 测试目录被识别为散落候选（默认 100MB 不识别），报告 organizeCandidates=1 + 终端"散落目录候选"均正确；默认阈值对照为 0。

---

## 7. Phase 5 — 定时任务（优化⑤）

- `disk-clean schedule add --every weekly --day sun --time 03:00 --command "scan C:\ D:\ --report"`。
- 实现：schtasks 注册（或 Windows 任务计划程序 XML）。
- 报告自动归档到 `~/.disk-clean/reports/`。
- `disk-clean schedule list|remove`。
- 安全：定时任务默认只做 scan/报告，不做破坏性操作（或要求显式 `--clean` 标记）。

**验收**：注册任务后运行一次，报告生成在归档目录；list/remove 正常。

---

## 8. Phase 6 — MFT 直读快速扫描（优化③）

- 调研：解析 NTFS MFT（`$MFT`）直接枚举文件元数据，绕过逐目录遍历。
- 实现方案（选一）：
  a. 纯 Node 读取 MFT（需要解析 MFT 记录格式，复杂但零依赖）
  b. PowerShell 调用 `fsutil` / 卷影 API（受限）
  c. 原生模块/外部工具调用（如 fsutil、Everything SDK）——优先级最低，违背零依赖
- 目标：全盘扫描从分钟级 → 秒级（参考 WizTree）。
- 降级：MFT 不可用（非 NTFS / 无权限）时回退到现有目录遍历。

**验收**：C 盘或 D 盘扫描 ≤10s（对比当前 57s），结果与遍历模式一致性抽查 ≥99%。

---

## 9. Phase 7 — SMART / SSD 健康（优化⑥）

- `disk-clean health`：读取各盘 SMART 数据：
  - HDD：Reallocated Sectors、Pending Sectors、Power-On Hours、温度（wmic / PowerShell Get-PhysicalDisk）
  - SSD：SSD Wear（Percent Lifetime Used，Get-PhysicalDisk 的 Wear）
- 输出：健康等级（健康/注意/警告/危险）+ Markdown/JSON 报告。
- 集成：scan 报告可选包含 health 摘要。

**验收**：真实机器上输出每块盘的 SMART 关键指标与健康等级。

---

## 10. Phase 8 — 全盘哈希 dedup（优化⑦）

- 现状：重复检测仅限用户数据目录（Downloads/Documents/Desktop/Pictures/Videos/Music/OneDrive）且 ≥1MB。
- 升级：
  a. 可选 `--full-dedup`：扩展到全盘（排除系统/程序目录）。
  b. 哈希策略：head/tail 两阶段（已实现）+ 大文件抽样哈希优化。
  c. 硬链接去重（`fsutil hardlink` 或 Node 无直接 API → PowerShell）：重复文件可选转换为硬链接（省空间，需谨慎 + 默认关闭）。
- 报告：重复文件分组 + 可释放空间预估。

**验收**：测试树构造重复文件，全盘模式检测到；硬链接去重可选开启且可回退。

---

## 11. Phase 9 — 每用户/每目录配额分析（优化⑧）

- `disk-clean quota`：按用户（`C:\Users\*`）+ 按目录聚合占用。
- 输出：各用户占用排行、`Users/<u>/Downloads|Documents|...` 各目录占用、可释放空间建议。
- 企业场景：同事间"谁的磁盘占用最多"一目了然。

**验收**：真实机器输出用户级与目录级占用排行表。

---

## 12. Phase 10 — 系统还原点（优化⑨）

- 破坏性操作（organize apply / clean）前可选 `--restore-point`：先创建系统还原点。
- 实现：PowerShell `Checkpoint-Computer`（需管理员 + 系统保护开启），失败则警告但不中止（降级为继续 + 日志记录）。
- 回滚增强：还原点信息写入审计日志/undo 文件。

**验收**：开启系统保护的环境下创建还原点成功；未开启时给出明确提示。

---

## 13. Phase 11 — i18n 多语言（优化⑩）

- 报告模板与 CLI 文案支持多语言：
  - `LANG=zh|en` 环境变量或 `--lang` 参数。
  - 报告模板抽成 `lib/i18n/<lang>.json`（类别名、建议文案、表格头、CLI 帮助）。
- 默认跟随系统语言（`chcp` / `$env:LANG`），兜底英文。
- 保持 JSON 数据字段不变（机器可读层不因语言变化）。

**验收**：`--lang en` 输出全英文报告与帮助；`--lang zh` 输出中文；默认行为合理。

---

## 14. 安全红线（贯穿所有阶段）

1. 永不删除/移动：系统关键目录、`C:\Windows` 家族、Program Files、ProgramData、winsxs、卷影/回收站。
2. 所有破坏性操作：dry-run 默认 + `--yes` 显式确认 + 审计日志 + 可回滚。
3. 快捷方式修复：仅改 TargetPath/Arguments/WorkingDirectory/IconLocation，先备份旧值到 undo 文件。
4. 跨盘移动失败：目标存在 / 权限不足时**跳过并记录**，不强制覆盖。
5. 退出码规范：0 成功 / 1 用户取消或参数错误 / 2 运行时错误 / 3 扫描被取消。

---

## 15. 里程碑

| 里程碑 | 内容 | 预计 |
|---|---|---|
| M1 | Phase 0-1 完成（可独立运行的 CLI） | 第 1-2 天 |
| M2 | Phase 2-3 完成（exe + 英文文档 + CI） | 第 3-4 天 |
| M3 | Phase 4-5 完成（配置 + 定时任务） | 第 5-6 天 |
| M4 | Phase 6-7 完成（MFT 秒扫 + SMART） | 第 7-9 天 |
| M5 | Phase 8-11 完成（dedup + 配额 + 还原点 + i18n） | 第 10-13 天 |
| M6 | Phase 12 发布 GitHub | 第 14 天 |

---

## 16. 测试策略

- **测试树**：`test/tree/` 预置固定结构（含散落大目录、程序目录、重复文件、空目录、垃圾文件），扫描/建议/整理回归。
- **单元级**：规则函数（分类、垃圾匹配、散落判定）——纯函数直接断言。
- **集成级**：完整 `scan → report → organize plan → apply → rollback` 在测试树执行。
- **真实盘抽查**：每阶段在 D 盘（或 C 盘用户区）执行一次扫描，对比前后报告关键数字。
- **安全测试**：构造系统目录路径样本，断言被拒绝。

---

## 17. 状态追踪

每完成一个阶段，更新本表（勾选 + 日期 + 备注）。

| 阶段 | 完成日期 | 备注 |
|---|---|---|
| Phase 0 | 2026-08-16 | 目录结构 + ROADMAP + package.json/.gitignore |
| Phase 1 | 2026-08-16 | 独立 CLI 全命令验证通过；修复 mkdir-EPERM/BOM/空批次/瞬时锁 4 个 bug；同步回插件 |
| Phase 2 | 2026-08-16 | SEA 单文件 exe（82MB，零外部二进制）；无 Node 环境验证通过；demo 素材 + build-sea.ps1 |
| Phase 3 | 2026-08-16 | 英文 README + MIT + CI(SEA) + CONTRIBUTING + issues 模板 + git 首次提交；zh-CN README 待补 |
| Phase 4 | 2026-08-16 | 规则配置文件 config.json：阈值覆盖 + exclude 白名单 + `config` 子命令(show/set/reset/path)；阈值生效对照验证通过 |
| Phase 5 | ⬜ | — |
| Phase 6 | ⬜ | — |
| Phase 7 | ⬜ | — |
| Phase 8 | ⬜ | — |
| Phase 9 | ⬜ | — |
| Phase 10 | ⬜ | — |
| Phase 11 | ⬜ | — |
| Phase 12 | ⬜ | — |
