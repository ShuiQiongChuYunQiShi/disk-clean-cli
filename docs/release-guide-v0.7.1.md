# 发版指南 v0.7.1

> 由 `node scripts/dev.js release-guide` 生成，**发布前必须人工补齐并勾选**。
> 通用流程见 `docs/RELEASE-PLAYBOOK.md`；本文件只讲"这一次"。
> 生成时间：2026-09-12T06:54:49.213Z

## 一、本次上线内容

- 区间：`v0.7.0..HEAD`（previous tag），共 2 个提交
- 净变更：3160 行（+3267 / -107），变更级别 **L**
- 产品代码（bin/lib/gui）净变更：80 行
- 其中**尚未提交**的部分：22 个文件，+2640 / -107 行（自动化生成时工作区仍是脏的）
- 变更级别要求的验证深度：dev verify + GUI 重建 + 安装器静默安装 + 人工界面验收 + 审批

| 类别 | 数量 | 说明 |
|---|---|---|
| feat | 1 | 新能力 |
| fix | 0 | 缺陷修复 |
| 其他 | 1 | 文档/测试/构建等 |

### 提交明细

- `a966ff6` feat(dev): unified dev entry (doctor + verify), and SOP gap analysis vs navigator
- `b52147a` docs: product review of v0.7.0 - usability gaps, dead configs, test pollution

### 本次要点（人工补齐）

本批次是**流程建设批次**（`docs/SOP-UPGRADE-PLAN.md` 的阶段二 + 阶段三），不是功能批次。
产品代码净变更仅 80 行，其中 60 余行是新增一条诊断命令与一句版本号后缀。

**新增的脚本级门禁（真正会拦住东西的）**

| 项 | 机制 | 拦住什么 |
|---|---|---|
| S4 发布审批 | `scripts/approval.js` + `publish-release.ps1` 第 0 步 | 无人批准不得发布；审批绑定**每个产物的 sha256**，重新构建后自动失效；`--yes/--force` 被显式拒绝 |
| S9 制品指纹 | `scripts/build-bundle.js` 注入 commit + `scripts/fingerprint.js` 断言 | "先构建、后改代码、再发布"这种发了旧包的情况 |
| S7 文档一致性 | `test/docs-consistency.js` | 文档数字/清单与实现漂移；**测试文件写了却没注册进 `test/all.js`**（那等于永远不跑）；死配置被当已实现承诺 |
| S3 声明式清单 | `disk-clean.config.json` + `scripts/manifest.js` | 仓库名/包名/资产名散落各处；构建了却没人发布的产物 |

**流程变更（需要知晓）**

- **CI 不再在 push tag 时自动创建 Release**。此前 `git push --tags` 会发布一个未获批、且只有引擎（没有 GUI 安装器）的半成品 Release，等于绕过审批门禁。现在 CI 只构建并上传 workflow artifact；发布只能由 `scripts/publish-release.ps1` 完成。
- 发布前置条件变成**硬性**：`docs/RELEASE_NOTES-v<ver>.md` 与 `docs/release-guide-v<ver>.md` 缺任一，`publish-release.ps1` 直接 exit 1。
- `publish-release.ps1` 的审批门禁排在 `GH_TOKEN` 检查**之前**——"该不该发"先于"能不能发"。

**用户可见变化（因此需要一条 CHANGELOG 与 Release Notes）**

- 新增 CLI 命令 `build-info`（输出版本 / commit / 是否脏树的 JSON）；`--version` 在制品形态下会追加构建短哈希。
- `~/.disk-clean/config.json` 的 `version` 字段被删除：它从未被读取，且与应用版本号同名、容易被误认为能改版本。
- `disk_config` 的 MCP 工具描述不再承诺 `retention.reports` / `junkRules` / `organizeRules`——这三个字段确实存在但引擎尚未读取，现在描述里会明说。

## 二、测试状态

下表中的 ✅ 是**流程建设批次提交后**（`5917b3e` / `3589147`）的真实实测结果，不是计划。
版本号 bump 到 0.7.1 之后必须重跑 `dev verify`：届时版本一致性、指纹 commit、清单路径都会变。

| 项 | 结果 | 证据 |
|---|---|---|
| 全量测试 | ✅ 15/15 | `node test/all.js` → `SUMMARY: 15/15 passed` |
| 一键验证链 | ✅ 7 步全过、**0 跳过** | `node scripts/dev.js verify`：语法 48 文件 / 15 套件 / `.ps1` ASCII 5 个 / 版本一致性 9 源 / 清单一致性 / 制品指纹 / exe 端到端 |
| 制品指纹（真实产物） | ✅ | `dist\disk-clean-win-x64.exe build-info` → `commit=3589147 dirty=false`，等于 HEAD |
| 脏树会被拒绝 | ✅ | 制造一个未提交文件后 `fingerprint.js check --require-clean-worktree` → exit 1，理由："有未提交改动（发布时不允许：tag 指向的提交不含这些改动）" |
| 发布门禁拦截 | ✅ | 无审批时 `publish-release.ps1 0.7.0` → **exit 1**，且输出中**无任何 preflight / tag / release 行**，即零副作用、未触网 |
| 审批门禁行为 | ✅ 19 项断言 | `node test/approval-gate.js`（放行 2 / 拦截 17） |
| 环境自检 | ⚠️ **2 项阻塞** | `node scripts/dev.js doctor` → `GH_TOKEN 未设置`、`NPM_TOKEN 未设置`（其余全绿：Node 22.21.1 / esbuild / postject / .NET 8.0.424 / Inno Setup 6 / gh / 代理 / 状态目录 / 审批目录 / 版本一致性） |
| 版本号 bump 到 0.7.1 | ☐ | 当前源码版本仍为 **0.7.0**，bump 后需重跑 `dev verify` |
| `docs/RELEASE_NOTES-v0.7.1.md` 已写 | ☐ | **发布前必须补**（缺则该文件会让发布脚本直接拒绝） |
| `CHANGELOG.md` 已补本版条目 | ☐ | **发布前必须补**；骨架可用 `node scripts/dev.js changelog` 生成 |
| CI 最新 run 绿 | ☐ | run 链接 |

> 注：`dev verify` 打印的"跳过"步骤不计入通过，必须数清楚。本次 7 步中 0 跳过，
> 是**因为 exe 已重建**——若 `dist/` 里没有产物，指纹与端到端两步会被显式标为 skip 并在汇总里列出。

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
