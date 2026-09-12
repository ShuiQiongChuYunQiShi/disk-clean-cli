# 能力矩阵（CAPABILITY-MATRIX）

> 本文件回答一个具体问题：**同一件事，在三个面上能不能做？**
> 由 `test/capability-matrix.js` 守门——矩阵里写的入口必须真实存在，
> 实现里的入口也必须出现在本文件里。新增能力却忘了更新这里，构建会失败。

## 0. 先说清"三个面"是什么

| 面 | 是什么 | 协议 | 入口文件 |
|---|---|---|---|
| **CLI** | 面向人与脚本的文本界面 | 文本 + 退出码 | `bin/disk-clean.js` |
| **MCP** | 面向 AI 客户端的工具接口 | JSON-RPC + JSON Schema | `bin/disk-clean-mcp.js` + `lib/mcp/` |
| **GUI** | 面向鼠标的原生窗口 | HTTP + DOM | `gui/shell/`（C# 壳）+ `lib/serve.js` + `gui/web/` |

两条容易搞混的事实：

1. **GUI 的引擎和 CLI 是同一个文件**：`build-installer.ps1` 把 `dist/disk-clean-win-x64.exe`
   复制成 `gui/stage/engine.exe` 打包进安装器。所以"CLI 与 GUI"其实在维护同一个产物。
2. 因此真正独立的第三个入口只有 **MCP**（随 npm 包分发）。

**同源的原则**：业务逻辑只写在 `lib/`。三个面都只是**协议薄壳**，
不得各自实现一遍能力。下面表格里的"差异"要么是**协议限制**（有理由保留），
要么是**待补的能力**（列在 §3）。

## 1. 矩阵

`—` 表示该面不支持。GUI 列列的是服务层端点（`lib/serve.js`）。

| 能力 | CLI | MCP | GUI |
|---|---|---|---|
| 磁盘扫描（分类/大文件/垃圾/空目录） | `scan` | `disk_scan` | `/api/scan` |
| 扫描进度反馈 | 状态行轮询 | — | `/api/scan/status`、`/api/scan/cancel` |
| 扫描范围确认（防误扫） | — | — | 前端弹窗（无独立端点） |
| 报告渲染与读取 | `report` | `disk_report` | `/api/report` |
| 报告溯源（生成时间与范围） | `report`、`scan` | `disk_report` | `/api/report` |
| 报告历史（归档清单） | `report`（--history） | `disk_report`（section=history） | `/api/reports` |
| 盘符与真实容量 | `drives` | `disk_drives` | `/api/drives` |
| 清理（垃圾/空目录/重复/回收站） | `clean` | `disk_clean` | `/api/clean` |
| 目录整理（计划/执行/回滚） | `organize` | `disk_organize` | `/api/organize` |
| 重复文件检测与硬链接合并 | `dedup` | `disk_dedup` | `/api/dedup` |
| 磁盘健康（SMART / SSD） | `health` | `disk_health` | `/api/health`、`/api/health-check` |
| 每用户配额分析 | `quota` | `disk_quota` | `/api/quota` |
| MFT 直读快速扫描 | `mftscan` | `disk_mftscan` | `/api/mftscan` |
| 审计日志 | `audit` | `disk_audit` | `/api/audit` |
| 回收站恢复（仅本工具项） | `clean`（recycle-bin） | `disk_recycle` | `/api/recycle/list`、`/api/recycle/restore` |
| 规则配置读写 | `config` | `disk_config` | `/api/config` |
| 定时扫描（注册 Windows 任务） | `schedule` | — | `/api/schedule` |
| 快捷方式修复 | `fix-shortcuts` | — | — |
| 系统还原点 | `clean`（--restore-point） | — | — |
| 构建自述（版本/commit/脏树） | `build-info` | — | — |
| 环境自检与首次引导 | `doctor` | — | — |
| MCP 服务本身 | `mcp` | — | — |
| GUI 引擎 HTTP 服务 | `serve` | — | 由 C# 壳启动 |

## 2. 为什么有些格子是空的（有理由的差异，不是欠债）

| 差异 | 理由 |
|---|---|
| MCP 没有 `schedule` / `fix-shortcuts` / `--restore-point` | 这三个都要求**改变系统状态**（注册计划任务、改快捷方式、建还原点），且需要交互式确认或管理员上下文。MCP 的 12 个工具刻意聚焦"AI 可以安全自动化"的范围；把系统级改动暴露给模型没有收益。 |
| MCP 没有扫描进度 | `tools/call` 是**同步**的，协议本身没有流式进度。要做得靠 MCP 的通知机制，属于协议层工作，不是能力缺失。 |
| CLI 没有扫描范围确认 | CLI 的范围就是命令行参数——**你打出来的就是你要扫的**，这是显式输入，不需要二次确认。GUI 之所以需要，是因为它默认勾选盘符、可能一键全盘。 |
| GUI 没有报告历史 | 见 §3 第 1 项：服务层也没有这个端点。 |
| `build-info` / `mcp` / `serve` 只在 CLI | 它们是**入口本身**，不是能力：`mcp` 与 `serve` 是启动另外两个面的进程，`build-info` 是给用户核对下载物的诊断命令。 |

## 3. 已登记的不一致

**当前没有未修复的不一致。** 下表记录的是曾经存在、现已修好的四项——
保留它们是为了让后来的人知道那些问题真实发生过，而不是把记录删掉当作没发生过。

| # | 曾存在的问题 | 现状 |
|---|---|---|
| 1 | **GUI 没有报告历史端点**：`report --history`（CLI）与 `section=history`（MCP）都有，而 `lib/serve.js` 连端点都没有 | ✅ 已修：`GET /api/reports`（清单）与 `GET /api/reports?file=<name>`（单份归档；只接受历史目录内的文件名，防目录穿越） |
| 2 | **GUI 前端不调用 `/api/report`**：端点一直存在，但 `gui/web/app.js` 从不请求它 | ✅ 已修：启动时加载最近报告。报告是全局单例、每次扫描覆盖，"上次扫出什么"恰恰是最常见的使用场景 |
| 3 | **CLI 没有扫描进度百分比/ETA** | ✅ 已处理，**结论是"不该给"**：扫描前总量未知（要遍历完才知道），画百分比是编造而非测量。改为已处理量 + 已用时间 + **吞吐速率**，足够区分"在动"与"卡住"；真实总量在结束时给出 |
| 4 | **GUI 恒定提权**（`app.manifest` 是 `requireAdministrator`） | ✅ 已修（T11）：改为 `asInvoker`；真正需要管理员的三个端点（MFT 直读 / SMART / 配额）在缺权限时返回明确提示 |

> **"修好了"不等于"从文档里删掉"。** 本文件的 §3 由 `test/capability-matrix.js` 守门：
> 已登记的欠债不能在修复之前被删（那等于把问题抹掉），而修好之后必须留下记录
> （否则同一个不对称会被重新引入）。当前欠债为零，因此测试断言的是"§3 仍保有已修复记录"。
## 4. 怎么加一个新能力（照做就不会漂移）

1. 逻辑写在 `lib/` 里（唯一实现）；若已有实现，先把它抽到 `lib/`，不要在壳里写第二份。
2. 在 CLI 的 `switch` 加 `case`，在 `lib/mcp/tools.js` 注册工具，需要时在 `lib/serve.js` 加端点。
3. **在本文件的 §1 表格里加一行**（哪些面支持就填哪些入口）。
4. 跑 `node test/all.js`：`capability-matrix` 会检查"矩阵声明的入口真实存在"与
   "实现里的入口都在矩阵里"，两边任何一边漏了都会失败。

> 这条流程的用处不是形式主义：本仓库历史上出现过多次"某能力只有 CLI 有、
> MCP 忘了加"或"加了工具但文档没写"，而**没有任何机制在它发生时发出声音**。
> 现在有了。
