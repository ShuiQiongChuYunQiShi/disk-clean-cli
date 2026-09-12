# 发版指南 v0.7.1

> 由 `node scripts/dev.js release-guide` 生成，**发布前必须人工补齐并勾选**。
> 通用流程见 `docs/RELEASE-PLAYBOOK.md`；本文件只讲"这一次"。
> 生成时间：2026-09-12T07:26:51.338Z

## 一、本次上线内容

- 区间：`v0.7.0..HEAD`（previous tag），共 12 个提交
- 净变更：4510 行（+4649 / -139），变更级别 **L**
- 产品代码（bin/lib/gui）净变更：380 行
- 变更级别要求的验证深度：dev verify + GUI 重建 + 安装器静默安装 + 人工界面验收 + 审批

| 类别 | 数量 | 说明 |
|---|---|---|
| feat | 3 | 新能力 |
| fix | 4 | 缺陷修复 |
| 其他 | 5 | 文档/测试/构建等 |

### 提交明细

- `ad26f71` release: v0.7.1 - trustworthy data, and gates instead of prose
- `4b5c43a` fix(cli): show suggestion titles instead of [type] type (T5), and be honest about --lang
- `871656c` fix(config): delete the last two dead config keys, and gate the whole category (T4)
- `797cd6e` feat(report): implement report history, so retention.reports finally does something (T3)
- `7798812` fix(report): give reports a provenance, and show it everywhere (T2)
- `56dba49` fix(test): isolate ~/.disk-clean in every suite, and guard it (T1)
- `cdb617f` docs: record the gate's positive path and the CI run in the v0.7.1 guide
- `ba1e2b6` docs: fill in the measured verification evidence for the v0.7.1 guide
- `3589147` docs: SOP phases 2-3 results, and a corrected reading of the navigator review
- `5917b3e` feat(dev): script-level release gates - approval, artifact fingerprint, doc consistency
- `a966ff6` feat(dev): unified dev entry (doctor + verify), and SOP gap analysis vs navigator
- `b52147a` docs: product review of v0.7.0 - usability gaps, dead configs, test pollution

### 本次要点（人工补齐）

本版是**两批合一的补丁版**：流程建设（S3–S10）+ 产品整改（T1–T5）。**无新增独立能力**，
按版本规则不升 minor，故为 0.7.1 而非 0.8.0。

**上半批：把流程从文档搬进脚本（三道门禁 + 清单 + 分级）**

| 项 | 机制 | 拦住什么 |
|---|---|---|
| S4 发布审批 | `scripts/approval.js` + `publish-release.ps1` 第 0 步 | 无人批准不得发布；审批绑定**每个产物的 sha256**，重新构建后自动失效；`--yes/--force` 被显式拒绝 |
| S9 制品指纹 | `scripts/build-bundle.js` 注入 commit + `scripts/fingerprint.js` 断言 | "先构建、后改代码、再发布"这种发了旧包的情况 |
| S7 文档一致性 | `test/docs-consistency.js` | 文档数字与实现漂移；**测试写了却没注册进 `test/all.js`**（等于永不运行）；死配置被当已实现承诺 |
| S3/S5/S6/S8 | `disk-clean.config.json` + `dev analyze/changelog/release-guide` | 发布资产散落成字面量；变更分级与发版指南靠人工 |

**下半批：产品整改（P0 + P1）**

- **T1（P0）测试不再写用户真实数据**：15 个套件里 12 个曾直接读写 `~/.disk-clean/`——
  报告被覆盖、审计被污染、测试文件被丢进用户回收站。现全部隔离，并加两层守卫
  （静态：新增套件漏隔离则整体失败；运行时：跑测试前后对真实目录做**内容哈希**比对）。
- **T2 报告溯源**：报告写入 `generatedAt` + 工具版本；CLI / MCP / GUI **每处输出**都显示生成时间与范围，
  超 24 小时提示重新扫描。旧报告回落到 `summary.scannedAt`，因此存量报告也能判断新旧。
- **T3 报告历史**：实现 `retention.reports`（此前从无读取点），每次扫描归档一份 gzip、
  保留最近 N 份；入口为 `report --history` 与 MCP `disk_report section=history`。
- **T4 配置面清查**：删除 `junkRules` / `organizeRules`（从未被读取却被承诺），
  并把"已删除字段不得卷土重来"变成断言。
- **T5 建议显示修复**：CLI 此前读错字段名，输出 `[junk-temp] junk-temp`，现显示真正的中文标题。
  同时按决定把 `--lang en` 改为**诚实说明**（英文 README 顶部注明 CLI 输出为中文）。

**流程变更（需知晓）**

- **CI 不再在 push tag 时自动创建 Release**。此前 `git push --tags` 会发布一个未获批、
  且只有引擎（没有 GUI 安装器）的半成品 Release，等于绕过审批门禁。
- 发布前置条件变成硬性：`docs/RELEASE_NOTES-v<ver>.md` 与 `docs/release-guide-v<ver>.md` 缺任一即拒绝发布。
- `publish-release.ps1` 的审批门禁排在 `GH_TOKEN` 检查之前——"该不该发"先于"能不能发"。

## 二、测试状态

下表中的 ✅ 是**本版提交后（`ad26f71`）在本机实测**的结果，不是计划。

| 项 | 结果 | 证据 |
|---|---|---|
| 全量检查 | ✅ **19/19** | `node test/all.js` → `SUMMARY: 19/19 passed`（17 个套件 + 2 项 runner 自检） |
| 一键验证链 | ✅ 7 步全过、**0 跳过** | `node scripts/dev.js verify`：语法 53 文件 / 19 项检查 / `.ps1` ASCII 5 个 / 版本一致性 9 源 / 清单一致性 / 制品指纹 / exe 端到端 |
| 制品指纹（真实 82 MB exe） | ✅ | `build-info` → `{"version":"0.7.1","commit":"ad26f71","dirty":false}`，等于 HEAD |
| 测试不碰真实状态目录 | ✅ | runner 后置自检：真实 `~/.disk-clean` **未被改动**（此前每跑一次测试都会被写入） |
| 报告溯源与历史 | ✅ | `report-provenance` / `report-history` 两套件覆盖（含 24h 边界、旧报告回落、gzip 往返、N 份裁剪、同秒撞名） |
| 版本一致性 | ✅ | `v0.7.1（9 个版本源一致）` |
| `docs/RELEASE_NOTES-v0.7.1.md` 已写 | ✅ | 本目录 |
| `CHANGELOG.md` 已补本版条目 | ✅ | `[0.7.1]` 段 |
| 环境自检 | ⚠️ **2 项阻塞** | `node scripts/dev.js doctor` → `GH_TOKEN 未设置`、`NPM_TOKEN 未设置`（其余全绿）。**发布前必须恢复** |
| 发布审批 | ☐ | 发布前由人执行 `node scripts/approval.js confirm --version 0.7.1 --by "<名字>"` |
| CI 最新 run 绿 | ☐ | 推送后填写 |

> `dev verify` 打印的"跳过"步骤不计入通过，必须数清楚。本次 7 步中 0 跳过，
> 是因为 exe 已按最终提交重建；若 `dist/` 无产物，指纹与端到端两步会被显式标为 skip 并在汇总里列出。

## 附：GUI 侧未验证项（如实记录）

本版**未改动 GUI 产品行为**（仅前端新增一行生成时间渲染 + 两个 i18n 键），
但变更级别为 L，按要求仍需 GUI 验收。截至生成本指南时**以下两项未做**：

- ☐ GUI 安装器重建：`powershell -File scripts\build-installer.ps1`
- ☐ 静默安装 + 启动 + 扫描 + 生成时间显示的界面验收

不要因为"只改了一行前端"就跳过——v0.3.x 那批事故正是"只改了一点"造成的。

## 三、上线前准备清单

- [ ] `git status` 干净，本地与远端一致（脏树会被指纹断言拒绝）
- [ ] 版本号已在 `lib/version.js` bump，`test/version-consistency.js` 通过
- [ ] 已提交并打 tag：`git tag v0.7.1` 且已推送
- [ ] 引擎已构建：`powershell -File scripts\build-sea.ps1`
- [ ] GUI 安装器已构建：`powershell -File scripts\build-installer.ps1`
- [ ] 指纹断言通过：`node scripts\fingerprint.js check`
- [ ] **人已批准**：`node scripts\approval.js confirm --version 0.7.1 --by "<名字>"`
- [ ] 环境自检通过：`node scripts/dev.js doctor`（GH_TOKEN / NPM_TOKEN / 代理）
- [ ] 回滚预案已知悉（见第六节）

## 四、上线步骤

```powershell
# 0) 自检与验证（任一失败即停止）
node scripts/dev.js doctor
node scripts/dev.js verify

# 1) 构建两侧产物（顺序不可颠倒：安装器内嵌引擎 exe）
powershell -ExecutionPolicy Bypass -File scripts\build-sea.ps1
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1

# 2) 断言制品 == 源码
node scripts/fingerprint.js check

# 3) 人批准（脚本不能代劳）
node scripts/approval.js request --version 0.7.1
node scripts/approval.js confirm --version 0.7.1 --by "你的名字"

# 4) 发布（内部再次校验审批 + 指纹 + 哈希；发布后回下载校验）
powershell -ExecutionPolicy Bypass -File scripts\publish-release.ps1 0.7.1 -PublishNpm
```

## 五、上线后验证清单

- [ ] GitHub Release 非 draft，6 个资产齐全（引擎 / 安装器 / 两个 .sha256 / SHA256SUMS.txt / checksums.txt）
- [ ] `checksums.txt` 里的 sha256 与下载下来的 exe 实测一致
- [ ] 下载 exe 后 `disk-clean.exe build-info` 的 commit 等于本次 tag 指向的 commit
- [ ] `npm view disk-clean version` 等于 0.7.1
- [ ] 静默安装安装器成功，GUI 能启动并扫描出结果
- [ ] CI 在 tag 上的 run 绿（CI 只构建与上传 artifact，不创建 Release）

## 六、风险与回滚

| 风险 | 影响 | 处置 |
|---|---|---|
| 产物与源码不一致 | 用户拿到不含本次修复的 exe | 已被 `fingerprint.js check` 拦下（发布前） |
| 发布后才发现严重缺陷 | 用户已下载 | GitHub Release 改为 draft 或删除该 Release；npm 用 `npm deprecate`（版本号不可回收） |
| 审批被绕过 | 未经确认的发布 | 本机文件门禁无法阻止有写权限的代理；发布凭据不应出现在代理可达环境（见 PLAYBOOK） |
| 只推了 tag、忘了跑发布脚本 | 有 tag 没有 Release，用户拿不到产物 | CI 不再自动创建 Release（那是绕过审批的口子）；`gh release view v0.7.1` 为空即为此情况 |

回滚命令：

```powershell
# 撤回 GitHub Release（保留 tag，供追溯）
gh release delete v0.7.1 --yes

# 撤回 npm 版本（已发布的版本号不能重用，只能标记弃用）
npm deprecate disk-clean@0.7.1 "本次发布有问题，请使用 <正确版本>"
```
