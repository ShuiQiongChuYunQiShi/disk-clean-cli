# 发版指南 v0.7.2

> 由 `node scripts/dev.js release-guide` 生成，**发布前必须人工补齐并勾选**。
> 通用流程见 `docs/RELEASE-PLAYBOOK.md`；本文件只讲"这一次"。
> 生成时间：2026-09-12T11:43:11.879Z

## 一、本次上线内容

- 区间：`v0.7.1..HEAD`（previous tag），共 11 个提交
- 净变更：1340 行（+1383 / -43），变更级别 **L**
- 产品代码（bin/lib/gui）净变更：520 行
- 其中**尚未提交**的部分：8 个文件，+203 / -9 行（自动化生成时工作区仍是脏的）
- 变更级别要求的验证深度：dev verify + GUI 重建 + 安装器静默安装 + 人工界面验收 + 审批

| 类别 | 数量 | 说明 |
|---|---|---|
| feat | 6 | 新能力 |
| fix | 3 | 缺陷修复 |
| 其他 | 2 | 文档/测试/构建等 |

### 提交明细

- `1a6fd21` feat(gui): report history endpoint and load the latest report on startup
- `b1aa38a` feat(cli): confirm the scan range, degrade progress in pipes, export HTML (T9/T10/T13)
- `976bc71` feat(gui): start without elevation, and gate the three features that need it (T11)
- `49e71d7` feat(cli): error messages that say what to do, plus a first-run doctor (T8)
- `8e951a5` feat(docs): capability matrix with a two-way gate (T7)
- `4eb3a9d` fix(test): pin the report language so the coverage test stops depending on locale
- `df59ad1` docs(review): mark T6 done with the measured result
- `bd7b543` feat(rules): rebuild classification from real occupancy, and expose what is left (T6)
- `06bedbd` fix(test): stop the home guard from asserting a cause it cannot prove
- `b625a5e` docs(roadmap): record v0.7.0/v0.7.1 and correct the Phase 11 acceptance
- `bbbb269` fix(release): expand ${version} in asset names too, and isolate the credential env in tests

## 二、测试状态

| 项 | 结果 | 证据 |
|---|---|---|
| `node scripts/dev.js verify` | ☐ | 输出粘贴处 |
| `docs/RELEASE_NOTES-v0.7.2.md` 已写 | ☐ | |
| `CHANGELOG.md` 已补本版条目 | ☐ | |
| CI 最新 run 绿 | ☐ | run 链接 |

## 三、上线前准备清单

- [ ] `git status` 干净，本地与远端一致（脏树会被指纹断言拒绝）
- [ ] 版本号已在 `lib/version.js` bump，`test/version-consistency.js` 通过
- [ ] 已提交并打 tag：`git tag v0.7.2` 且已推送
- [ ] 引擎已构建：`powershell -File scripts\build-sea.ps1`
- [ ] GUI 安装器已构建：`powershell -File scripts\build-installer.ps1`
- [ ] 指纹断言通过：`node scripts\fingerprint.js check`
- [ ] **人已批准**：`node scripts\approval.js confirm --version 0.7.2 --by "<名字>"`
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
node scripts/approval.js request --version 0.7.2
node scripts/approval.js confirm --version 0.7.2 --by "你的名字"

# 4) 发布（内部再次校验审批 + 指纹 + 哈希；发布后回下载校验）
powershell -ExecutionPolicy Bypass -File scripts\publish-release.ps1 0.7.2 -PublishNpm
```

## 五、上线后验证清单

- [ ] GitHub Release 非 draft，6 个资产齐全（引擎 / 安装器 / 两个 .sha256 / SHA256SUMS.txt / checksums.txt）
- [ ] `checksums.txt` 里的 sha256 与下载下来的 exe 实测一致
- [ ] 下载 exe 后 `disk-clean.exe build-info` 的 commit 等于本次 tag 指向的 commit
- [ ] `npm view disk-clean version` 等于 0.7.2
- [ ] 静默安装安装器成功，GUI 能启动并扫描出结果
- [ ] CI 在 tag 上的 run 绿（CI 只构建与上传 artifact，不创建 Release）

## 六、风险与回滚

| 风险 | 影响 | 处置 |
|---|---|---|
| 产物与源码不一致 | 用户拿到不含本次修复的 exe | 已被 `fingerprint.js check` 拦下（发布前） |
| 发布后才发现严重缺陷 | 用户已下载 | GitHub Release 改为 draft 或删除该 Release；npm 用 `npm deprecate`（版本号不可回收） |
| 审批被绕过 | 未经确认的发布 | 本机文件门禁无法阻止有写权限的代理；发布凭据不应出现在代理可达环境（见 PLAYBOOK） |
| 只推了 tag、忘了跑发布脚本 | 有 tag 没有 Release，用户拿不到产物 | CI 不再自动创建 Release（那是绕过审批的口子）；`gh release view v0.7.2` 为空即为此情况 |

回滚命令：

```powershell
# 撤回 GitHub Release（保留 tag，供追溯）
gh release delete v0.7.2 --yes

# 撤回 npm 版本（已发布的版本号不能重用，只能标记弃用）
npm deprecate disk-clean@0.7.2 "本次发布有问题，请使用 <正确版本>"
```
