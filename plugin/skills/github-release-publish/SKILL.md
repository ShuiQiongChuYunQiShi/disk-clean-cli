---
name: github-release-publish
description: 将项目发布到 GitHub Releases（tag + 资产上传 + SHA 校验 + CI 验证）。当用户要求"发布到 GitHub"、"打 tag"、"发版"、"上传 Release 资产"、"生成 SHA256SUMS"、"验证发布"时使用。与 windows-exe-packaging（打包）、dsh-plugin-creation（插件）互补。
---

# GitHub Release 发布（tag + 资产 + 校验）

> **权威文档**：`docs/RELEASE-PLAYBOOK.md §4`（GitHub SOP）、`§3.5.5`（GUI 验证）、`docs/PROCESS-REVIEW.md §7`（发布坑）

## 零、发布前必读

```
本地全量回归 → 版本 bump → commit → tag → Release 说明 → SHA256 → GitHub 搬运
GitHub 只做搬运，判据在本地。
```

## 一、认证（坑多，照做）

- `gh` 在 `C:\Program Files\GitHub CLI\gh.exe`（不在 PATH 时用全路径）
- **fine-grained PAT 不能 `gh auth login --with-token`**（报 401）→ 用环境变量：
  ```powershell
  $env:GH_TOKEN = 'github_pat_...'
  ```
  每次 pwsh 调用前注入，不跨调用持久
- token 权限不足不能建仓库→列选项让用户选，不卡住

## 二、提交与版本

- **英文 commit message**，单 commit 一个主题；文档与代码同步提交
- **版本四源一致**（发布前 grep 核对）：
  ```
  bin/VER  +  lib/serve.js VER  +  DiskCleanUi.csproj Version  +  package.json version
  checksums.txt version= 来源于 package.json
  ```
- bumping 后重打包，exe 与源码同步提交

## 三、Release 资产

| 资产 | 来源 | 大小 |
|---|---|---|
| `disk-clean-setup-<ver>.exe` | `gui/dist/`（Inno LZMA2） | ~26MB |
| `disk-clean-setup-<ver>.exe.sha256` | 构建生成 | - |
| `disk-clean-win-x64.exe` | `dist/`（SEA） | ~82MB |
| `disk-clean-win-x64.exe.sha256` | `dist/` | - |
| `SHA256SUMS.txt` | **发布时手工组装**（build-sea 只写 `dist/checksums.txt` + `exe.sha256`） | - |

```powershell
# SHA256SUMS.txt 组装（发布前重算）
$setupSha = (Get-FileHash gui/dist/setup-*.exe -Algorithm SHA256).Hash.ToLower()
$engineSha = (Get-FileHash dist/disk-clean-win-x64.exe -Algorithm SHA256).Hash.ToLower()
@"
$engineSha  disk-clean-win-x64.exe
$setupSha  disk-clean-setup-<ver>.exe
"@ | Out-File dist/SHA256SUMS.txt -Encoding utf8NoBOM
```

## 四、发布流程

### 1. 打 tag

```powershell
git tag v0.3.1
git push origin v0.3.1
```

### 2. 创建 Release（非 draft）

```powershell
$notes | Out-File C:\temp\notes.md -Encoding UTF8
& "C:\Program Files\GitHub CLI\gh.exe" release create v0.3.1 --title "v0.3.1" --latest --notes-file C:\temp\notes.md
```

验证：`draft=false`, `prerelease=false`

```powershell
Invoke-RestMethod https://api.github.com/repos/<owner>/<repo>/releases/tags/v0.3.1 -Headers @{Authorization="Bearer $env:GH_TOKEN"}
```

### 3. 上传资产（后台任务，82MB 会超时）

```powershell
& $gh release upload v0.3.1 `
  'gui\dist\disk-clean-setup-0.3.1.exe' `
  'gui\dist\disk-clean-setup-0.3.1.exe.sha256' `
  'dist\disk-clean-win-x64.exe' `
  'dist\disk-clean-win-x64.exe.sha256' `
  'dist\SHA256SUMS.txt' --clobber
# 后台跑：run_in_background=true
```

**上传期间不动源文件**（破坏半传文件）

### 4. 校验（双向核对）

```powershell
# 列资产
Invoke-RestMethod https://api.github.com/repos/<owner>/<repo>/releases/tags/v0.3.1 -Headers $h | % assets

# 从 GitHub 下载 → Get-FileHash 对比
Invoke-WebRequest https://github.com/<owner>/<repo>/releases/download/v0.3.1/disk-clean-setup-0.3.1.exe -OutFile C:\temp\dl.exe
(Get-FileHash C:\temp\dl.exe -Algorithm SHA256).Hash -eq $setupSha  # 必须 True
(Get-FileHash C:\temp\dl-engine.exe -Algorithm SHA256).Hash -eq $engineSha
```

## 五、CI 铁律

- 测试代码**禁止本机绝对路径**（CI 目录 `D:\a\...`），用仓库内相对路径 + 运行时自建测试树
- 语法检查覆盖**全部** `bin/lib/*.js`（不只 4 个核心）
- CI 修复后 `gh workflow run` 重触发，不删 tag
- `Release 必须非 draft`；CI workflow 手动验证

## 六、高频坑

| 坑 | 修复 |
|---|---|
| `gh auth login --with-token` 401 | 用 `$env:GH_TOKEN` |
| 82MB 上传超时 | 后台任务 + `--clobber` |
| 上传期间重建源文件 | 禁止，半传文件被破坏 |
| `gh release delete` 静默失败（exit 0 未删） | API `DELETE /repos/{owner}/{repo}/releases/{id}` 兜底（204） |
| Release draft 残留 | API 删除，`isDraft=false` 校验 |
| gh shell 输出混入 stderr | PowerShell 5.1 NativeCommandError 噪音→用 API 验证 |
| `SHA256SUMS.txt` 仍是旧值 | 每次构建后重算；发布前本地 sha × 资产 digest 双向核对 |
| 版本漂移 | 四源 grep 核对 |

## 七、发布检查清单

- [ ] `git status` 干净、`ls-remote origin master` 一致
- [ ] Release 非 draft、资产哈希与本地一致（含 GUI setup + 引擎两处 sha）
- [ ] CI 最新 run 成功
- [ ] README Option A/B/C/D 链接有效（勿用 `../README.md` 仓库外链接）
- [ ] `lib/` ⇄ `plugin/plugins/dsk-lib/` 同源已同步
- [ ] 版本四源一致
- [ ] GUI：serve 层 API 全冒烟、headless 零 JS 错误、静默安装 + GitHub 下载校验通过

## 八、持续优化

| 发现什么 | 更新哪里 |
|---|---|
| 上传失败/超时 | 本技能 §四 + `PROCESS-REVIEW` |
| 认证/权限变更 | 本技能 §一 |
| 资产清单变更 | §三 + `build-installer.ps1` |
| 新坑 | `PROCESS-REVIEW §7` + 本技能 §六 |

> 每次发布后立即用 API 校验 `draft/prerelease`，用 `Get-FileHash` 双向核对 digest，再更新技能。
