# 每轮改动同步清单（防漂移）

> 每轮功能/修复改动后，逐项打勾。完成后 `git status` 应干净、`git rev-parse HEAD` == `ls-remote origin master`。

## 代码

- [ ] `lib/` 桌面引擎（`engine.js` / `health.js` / `clean.js` / `serve.js` / `rules.js`）
- [ ] `plugins/` 插件引擎（`dsk-helper.js` / `dsk-rules.js` / `host.js` / `host.static5.js` / `client.js`）
- [ ] `gui/web/` 桌面前端（`app.js` / `ui-kit.js` / `index.html` / `style.css`）

## 同步（三处）

- [ ] `product/disk-analyzer`（开发源）
- [ ] `C:\Users\Administrator\.dsh\.agent-presets\disk-analyzer`（安装位置，生效基准）
- [ ] `disk-clean-cli/plugin`（仓库，`plugin/plugins` + `plugin/skills`）

> 规则表改动：改 `lib/rules.js` → `powershell -File scripts/sync-rules.ps1` → MD5 一致

## 文档与技能

- [ ] `docs/RELEASE-PLAYBOOK.md`（制作/发布 SOP，§3.5 GUI 若涉及）
- [ ] `docs/PROCESS-REVIEW.md`（Gxx 错误/复盘，§7 表格 + 防复发要点）
- [ ] `docs/OPTIMIZATION-PLAN.md`（如涉及阶段/路线图）
- [ ] `plugin/skills/*` 全局技能（`~/.agents/skills` + 预设 `skills` + 仓库 `plugin/skills` 三处 MD5 一致）

## 版本与构建（若涉及）

- [ ] `node scripts/bump-version.js <from> <to>`（四源 + iss + index，无 BOM）
- [ ] `powershell -File scripts/build-installer.ps1`（图标 step0 → publish → SEA → stage → ISCC）
- [ ] 静默安装验证（`EXIT=0` → 引擎版本 → 健康 → 页面 200）
- [ ] `dist/SHA256SUMS.txt` 已重算（`publish-release.ps1` 会再算一次）

## 发布（若涉及）

- [ ] `git tag <ver>` + `git push origin <ver>`
- [ ] `powershell -File scripts/publish-release.ps1 <ver>`（非 draft、资产 SHA 双向 MATCH）
- [ ] 或 `powershell -File scripts/push.ps1`（代理容错 + local==remote 校验）

## 收尾

- [ ] `node --check` 全过（`bin/` + `lib/` + `gui/web/` + `plugins/`）
- [ ] `git status` 干净，`git rev-parse HEAD` == `ls-remote origin master`
