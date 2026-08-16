# release-sop —— disk-clean 制作与发布流程（可复用 SOP）

## 定位（何时加载）

用户要求：做/改 DSH 插件、做/改 CLI、做/改 **GUI 桌面端**、上传 GitHub、打包发布、或问"这套机制怎么复用/新会话还能不能用"时加载。
本技能 = **速查 + 指针**；完整权威流程在仓库文档 `docs/RELEASE-PLAYBOOK.md`（SOP）与
`docs/PROCESS-REVIEW.md`（错误清单/复盘）以及 `docs/GUI-PLAN.md`（GUI 设计），永远以仓库为准，
勿在本文件复制长内容造成漂移。GUI 专项细节另见 `skills/gui-development/SKILL.md`。

## 第一步：先读权威文档

```text
读取 D:\deepseekHerness\windowsClear\RELEASE-PLAYBOOK.md（工作目录副本，优先）
或 D:\deepseekHerness\disk-clean-cli\docs\RELEASE-PLAYBOOK.md（仓库权威版）
以及 docs\PROCESS-REVIEW.md（错误清单/复盘）和 docs\GUI-PLAN.md（GUI 设计/验收点）
```

仓库路径：`D:\deepseekHerness\disk-clean-cli\`（GitHub: ShuiQiongChuYunQiShi/disk-clean-cli，master）。
开发源/产品目录：`D:\deepseekHerness\windowsClear\product\disk-analyzer\`（非 git）。
安装位置：`C:\Users\Administrator\.dsh\.agent-presets\disk-analyzer\`（生效副本，以它为镜像基准）。

## 四环节速查

### A. 插件（DSH）
- 双形态：静态 `plugin/plugins/disk-analyzer/host.static5.js`（会话挂载即注册 8 工具，免审批）
  + 动态模板 `host.js`（`__DSK_DIR__` 占位，cordis_define 安装，面板）。
- 路径铁律：DSK_DIR 用 `require('node:path')`+`__dirname` 推导（上溯两级 = preset 根），
  **禁止硬编码机器路径**；发布前 grep `Administrator`。
- 辅助进程纯 Node、无 spawnSync，输出 `'\n'+JSON`；宿主 parseHelperOut 取 lastIndexOf('\n') 之后。
- 安全四件套：DSH 审批 + 白名单 + `.dsk-audit.json` 审计 + 回滚映射（organize-map / dedup-map）。
- 验证：`node --check` 全部 js → 端到端（scan/clean/organize/audit + health/mftscan/dedup/quota）
  → **新开会话生效**（告知用户）。
- 发布：比对哈希后以**安装位置**为基准镜像到仓库 `plugin/`，README 同步，修复仓库外链接。

### B. CLI
- `bin/disk-clean.js`（VER 常量）+ `lib/` 引擎 + `scripts/build-sea.ps1`（**全 ASCII**，SEA 打包）。
- 子进程自我调用 `--internal-*`，按 IS_SEA 分派；零运行时依赖（Node 内建 + PowerShell 补齐）。
- 版本 bump → 重打包 → **全命令回归** → commit（exe 与源码同步）。

### C. GitHub 上传
- 认证：fine-grained PAT 用 `$env:GH_TOKEN`（`gh auth login --with-token` 报 401）；
  token 不能建仓库时列出选项让用户选，不卡住。
- 提交：英文 message；本地全量回归 → bump → commit → tag → Release 说明 → SHA256，GitHub 只搬运。
- 82MB exe 上传用**后台任务**（gh release create 会超时）。

### D. 打包发布
- 资产：`disk-clean-setup-<ver>.exe`（GUI 安装器）+ `disk-clean-win-x64.exe`（引擎）+
  `*exe.sha256` + `SHA256SUMS.txt`（含两项校验和，**每次构建后重算**）。
- Release **非 draft**；哈希核对（Get-FileHash 与资产 digest 一致）；CI 最新 run 成功。
- CI 测试禁止本机绝对路径；语法检查覆盖全部 bin/lib/*.js；CI 修复后 `gh workflow run` 重触发，不删 tag。
- 上传 26MB/82MB 大文件用**后台任务 + --clobber**；上传期间不动源文件。
- 遗留 draft 删除用 API `DELETE /releases/{id}` 兜底（gh delete 偶发静默失败）。

### E. GUI 桌面端（WebView2，v0.3.0 新增；细节见 gui-development 技能）
- 三进程：C# 壳（提权+spawn 引擎+WebView2）→ `engine.exe serve --port <p> --token <t> --web <dir>` → 前端加载 127.0.0.1。
- **CLI 位置参数坑**：spawn 传 `serve` 不是 `--serve`（flag → cmd=undefined → 打印 help 退 0）。
- serve 层：仅绑 127.0.0.1 + Bearer 鉴权（health 除外）；clean 空路径自动提取候选（宁拒勿删）。
- 前端零依赖暗色仪表盘：主页 + 8 高级 Tab，双语 i18n（localStorage），token 注入 + query 兜底。
- 安装器：框架依赖 + 缺则引导 bootstrapper；检测用文件夹探测（FindFirst 8.0.*）而非注册表。
- 构建顺序铁律：改 serve.js → 重建 SEA → 再组装安装器；`scripts/build-installer.ps1` 固化全链。
- 验证链：API 冒烟 → Edge headless=`--headless=new --user-data-dir`（旧模式空输出）→ 静默安装 → GitHub 下载 sha 校验 → 启动 → 健康 → 页面 200。

## 编码与 PowerShell 铁律（每题必查）

1. UTF-8 **无 BOM** 写文件（PS 5.1 `-Encoding UTF8` 写 BOM + 按 ANSI 读入 → 中文必坏）。
2. 跨进程输出严格 UTF-8 解码失败回退 GBK。
3. 脚本文件全 ASCII（CI pwsh7 下中文破坏字符串）。
4. 多行 PS 写 .ps1 + `-File`；`cmd /c` 整体包裹引号；**PS 5.1 无 `&&`、无三元 `? :`**（用分号/if-else）；
   Node 路径先存变量再 `&`；含引号/反斜杠的 JSON 参数写文件传参。
5. 硬链接用 `fs.linkSync`（PowerShell New-Item 被沙箱管道限制拦截）；备份+失败回滚。
6. C#/GUI 增补：日志读 `-Encoding UTF8`；C# 引擎重定向 `StandardOutputEncoding=UTF8`；
   PS 5.1 `ProcessStartInfo` 无 `ArgumentList`（用 `Arguments` 字符串 + `\"` 包裹路径）。

## 快速检查清单（发布前）

- [ ] git status 干净，ls-remote 与本地一致
- [ ] 插件/仓库 grep 无机器路径，node --check 全过
- [ ] Release 非 draft、哈希一致（GUI setup + 引擎两处）、CI 绿
- [ ] README Option A/B/C/D 链接有效（勿用 `../README.md` 仓库外链接）
- [ ] `lib/` ⇄ `plugin/plugins/dsk-lib/` 同源已同步
- [ ] 版本四源一致：bin/VER、lib/serve.js VER、DiskCleanUi.csproj Version、package.json version
- [ ] GUI：serve 层 API 全冒烟、headless 渲染零 JS 错误、静默安装 + GitHub 下载校验通过