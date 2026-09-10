## v0.5.0 — AI 接入改用标准 MCP

> ⚠️ **破坏性变更**：DSH 专有插件形态已删除，AI 访问改走标准 MCP server。

### 为什么删掉插件形态

`plugin/` 目录（约 3400 行 DSH 专属代码）被整体移除，原因不是"不想要"，而是它有三重无法挽回的问题：

1. **出货形态下技术不可行** —— preset 挂的是静态宿主半，而 `harness.*` 只存在于动态插件求值环境。
   即图表面板在用户实际安装的形态里永远渲染不出来（要修就得写第五份 UI）。
2. **安全修复已静默漂移** —— `host.static5.js` 里既没有 `isCloudSyncPath` 也没有 `stale-large`，
   而 `lib/` 侧早就修了。同一个引擎存在两份，改一处就会漏另一处。
3. **缺陷密度最高、测试为零** —— 极限锐评的 P0-1/2/3/4 全部位于该形态，`test/` 无一文件触及它。

### 现在怎么用 AI 操作磁盘

内置 MCP server，**零运行时依赖**，一行配置即可接入：

```jsonc
// DeepSeek Harness / Claude Desktop / Cursor —— 同一个配置到处可用
{ "mcpServers": { "disk-clean": { "command": "npx", "args": ["-y", "disk-clean", "mcp"] } } }
```

DSH 用户在 agent preset 的 `agent.cordis.yml` 里加一行（零自定义 JS，工具以 `mcp__disk-clean__disk_scan` 形式出现）：

```yaml
- name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: disk-clean
    transport: stdio
    command: node
    args: ['<仓库路径>\\bin\\disk-clean-mcp.js']
```

### 12 个 MCP 工具

| 工具 | 作用 |
|---|---|
| `disk_scan` / `disk_report` | 扫描建报告（JSON + Markdown）/ 只读取报告 |
| `disk_drives` | 真实盘符容量（`fs.statfsSync`） |
| `disk_clean` | 清理临时/空目录/重复/陈旧大文件（移入回收站）/ 清空回收站（永久） |
| `disk_organize` | 散落目录整理计划 / 执行 / 回滚（含快捷方式重写） |
| `disk_dedup` | 全盘查重 / 硬链接合并 / 回滚 |
| `disk_health` / `disk_quota` / `disk_mftscan` | SMART 健康 + 趋势 / 按用户配额 / MFT 直读快扫 |
| `disk_audit` / `disk_recycle` / `disk_config` | 审计日志 / 回收站列出与恢复 / 规则配置 |

**安全语义**：破坏性工具默认 **dry-run**，必须显式 `confirm:true`；每个工具带 MCP 注解
（`readOnlyHint` / `destructiveHint`）；所有拒绝都返回可行动的 `hint`。

### 修掉的实质缺陷

这些不是重构，是会真出事的 bug：

- **清理 0 项却报成功** —— 模型/用户会据此宣布"清理完成"。
- **清空回收站不报规模** —— 现在枚举真实条目数、标注不可恢复、并二次校验数量确实下降。
- **硬链接回滚会丢数据** —— 原实现把整个文件读进内存（几 GB 视频直接打爆）且"先删后写"；
  改为 rename → 从保留副本复制 → 校验大小 → 删备份，任一步失败原地复原。
- **回收站恢复找不到刚清理的文件** —— 审计记录与回收站 `$I` 记录的路径拼写不同
  （8.3 短名 `ADMINI~1` vs 长名 `Administrator`），纯字符串比较必然失配。
  本机 `%TEMP%` 正是短名形式，实测"清理 3 项后 `toolMatched=0`"——等于清理完就恢复不了。
- **`.ts` 在分类表里重复定义被静默覆盖** —— 同时声明为「媒体」和「代码」，后写覆盖先写；
  `node --check` 不报，只有 esbuild 打包时给一条易被忽略的警告。
- **静态托管越界判定** —— `startsWith` 会放行同名前缀的兄弟目录（`web-evil` 冒充 `web`）。
- 另有：临时目录改精确段匹配（`temporary-report` 不再被误判）、query token 默认拒绝、
  盘符正则锚定、dedup 根不可访问不再静默返回"0 组"。

### 单一事实源

| 维度 | 之前 | 现在 |
|---|---|---|
| 路径安全闸门 | `clean.js` / `organize.js` / `serve.js` 各一份 | `lib/guard.js`（受保护段 8 → 16） |
| 版本号 | 散落 6 处 | `lib/version.js`（7 个派生源 + 自动守门） |
| 业务逻辑 | CLI 与插件双份引擎 | 只有 `lib/`，CLI/MCP/GUI 都是薄壳 |

### 其它变更

- `engines.node` → `>=18.15`（`fs.statfsSync` 与 `node:sea` 的下限）。
- 新增 `disk-clean-mcp` bin 与 `disk-clean mcp` 子命令。
- 测试 5 个套件 → **9 个**（新增 MCP 协议、DSH 配置验证、规则完整性、版本一致性）。
- CI 改用 `npm ci`，顶层 `permissions: contents: read`。
- 危险测试（真实往回收站删文件）改为 `DSK_TEST_REAL_DELETE=1` 门控。

### 安装

| 方式 | 文件 |
|---|---|
| 单文件 CLI / MCP（免 Node） | `disk-clean-win-x64.exe` |
| 原生 GUI 窗口（WebView2） | `disk-clean-setup-0.5.0.exe` |
| npm（本轮未发布） | 下一轮补发 |

> 校验：`SHA256SUMS.txt` 含上述两个产物的校验和。

### 验证

- 9/9 测试套件通过；版本 9 个源一致。
- 端到端（源码形态与打包 exe 各跑一遍）：`disk_scan → dry-run → clean → 回收站恢复 → dedup → 安全负例 → 审计`，
  stdout 19 行响应零非协议输出。
- 0.4.1 → 0.5.0 覆盖安装验证通过（静默安装 exit 0，注册表版本 0.5.0，
  已安装引擎 serve 层 health 200 / 无 token 401 / 带 token 200）。
