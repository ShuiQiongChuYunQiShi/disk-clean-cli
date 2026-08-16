# disk-clean 制作与发布 SOP —— 可复用 Playbook

> 本文是**操作手册**（照着做就行），与 `PROCESS-REVIEW.md`（复盘：学了什么）互补。
> 适用范围：在 DeepSeek Harness（DSH）上制作 Windows 磁盘工具——双形态交付（DSH 插件 + 独立 CLI），
> 上传 GitHub，打包 Release。新项目可直接复用本流程。

---

## 0. 机制总览（先看这张图）

```
引擎（唯一权威源）
   ├─► DSH 插件（对话式 AI）：plugin/plugins/dsk-adv.js + dsk-lib/（= CLI lib 副本）
   │     静态 presethost.static5.js（会话挂载即用，免审批）
   │     动态模板 host.js（__DSK_DIR__ 占位，cordis_define 安装，带可视化面板）
   └─► 独立 CLI（Node / SEA 单文件 exe）：bin/ + lib/ + scripts/build-sea.ps1
            │
            ▼
   GitHub 仓库（同一仓库承载两侧）→ Release 资产（exe + SHA256SUMS）→ CI 回归
```

- **同源铁律**：引擎只写一处；插件 `dsk-lib/` 与 CLI `lib/` 互为副本，改动必须**双向同步**。
- **两条分发线共享同一仓库**：CLI 是第一入口（Release 资产），插件放 `plugin/` 目录随仓库分发。

---

## 1. 新项目启动（骨架）

```
<repo>/
├── bin/            # CLI 入口（disk-clean.js，含 VER 版本常量）
├── lib/            # CLI 引擎（engine.js / health.js / mftscan.js / dedup.js / quota.js …）
├── scripts/        # build-sea.ps1（**全 ASCII**，SEA 打包）
├── test/           # CI smoke test（**仓库内相对路径，禁止本机绝对路径**）
├── docs/           # RELEASE-PLAYBOOK.md / PROCESS-REVIEW.md / RELEASE_NOTES-*.md
├── plugin/         # DSH 插件分发目录（见 §2）
├── .github/workflows/
├── README.md       # Option A 单文件 exe / Option B npm / Option C DSH 插件（链接指向 plugin/README.md）
├── CHANGELOG.md
└── package.json / sea-config.json / LICENSE / ROADMAP.md
```

**起步顺序**：`package.json + git init` → 引擎最小可跑 → 双形态骨架 → 首个 Commit 就入库（编码铁律见 §5）。

---

## 2. 插件制作 SOP（DSH）

### 2.1 双形态（必须同时维护）

| 形态 | 文件 | 加载方式 | 适用 |
|---|---|---|---|
| 静态插件 | `plugin/plugins/disk-analyzer/host.static5.js` | `agent.cordis.yml` 直接引用，**会话挂载即注册工具**，免 cordis_define / 免审批 | 模型侧工具 + 文本报告（主推） |
| 动态模板 | `plugin/plugins/disk-analyzer/host.js` + `client.js` | `__DSK_DIR__` 占位 → cordis_define 安装 | 交互式图表面板（可选增强） |

### 2.2 目录结构（preset 根 = 任意主机预设 id）

```
.env 预设根/<id>/
├── agent.cordis.yml                 # 预设组成（插件行 name: './plugins/disk-analyzer/host.static5.js'）
├── preset.yml
├── plugins/
│   ├── dsk-helper.js                # 引擎辅助进程
│   ├── dsk-adv.js                   # 高级功能辅助进程（健康/MFT/去重/配额）
│   ├── dsk-lib/                     # 高级功能引擎（与 CLI lib/ 同源）
│   └── disk-analyzer/{host.static5.js, host.js, client.js, dsk-client.js, dsk-helper.js}
└── skills/                          # 使用手册（SKILL.md 注入新会话）
```

### 2.3 路径铁律（防发布即坏）

- **禁止硬编码机器路径**（如 `C:\Users\Administrator\...`）。`host.static5.js` 顶部用
  `require('node:path')` + `__dirname` 推导：`path.resolve(__dirname, '..', '..')` = preset 根。
  try/catch 回退旧硬编码兜底。发布前 grep 全目录确认无 `Administrator` / 开发机盘路径。
- 相对引用（`agent.cordis.yml` → `./plugins/...`）以 preset 根为基准，**复制后保持结构不变**。

### 2.4 工具注册（两种风格，二选一配套）

- 静态插件：`ctx.tools.register(tool)`（`inject: ['timer','tools']`），工具对象 `{ name, description, schema, action }`。
- 动态插件：`harness.defineTool({...})` + `harness.registerTool(ctx, tool)`。
- 工具命名 `disk_*` 前缀；描述必须自含完整用法（模型只读 description）。

### 2.5 辅助进程模式（关键）

- 辅助进程（dsk-helper / dsk-adv）为**纯 Node**：原生 `fs`、**不用 `spawnSync`**（沙箱管道限制），
  输出协议 `'\n' + JSON.stringify(obj)`，宿主 `parseHelperOut` 取 lastIndexOf('\n') 之后解析。
- 宿主用 `ctx.get('subprocess')` 以 `spawn(node, [...argv])` 启动；`cwd` 用固定盘根即可。
- 高级功能统一走 dsk-adv.js 多模式分发：`mftscan <drive>` / `dedup <json>` / `dedup-hardlink <json>` /
  `dedup-rollback <json>` / `quota <drive>`。

### 2.6 安全模型（插件独有，CLI 可借鉴）

1. 默认只建议不执行；删除 = 预览 → 用户确认 → **DSH 审批**（`approval.request`，双确认）。
2. 优先移入回收站（可恢复）；仅回收站清空永久删除。
3. **白名单**：执行路径必须来自最近一次报告的建议明细，拒绝一切清单外路径。
4. 系统目录只统计不清理。
5. 每次执行写 `.dsk-audit.json` 审计（时间/类型/路径/字节/结果）。
6. 删除走 PowerShell（UTF-16LE base64 + 单引号转义）；**硬链接用 `fs.linkSync` 而非 PowerShell New-Item**
   （沙箱管道问题），备份 `victim → victim.dsk-dup-bak`，失败回滚。
7. 破坏性操作一律可回滚：整理/去重写映射文件（organize-map / dedup-map）。

### 2.7 插件验证清单

- [ ] 全部 `.js` 过 `node --check`
- [ ] 端到端：scan → report → clean(审批) → organize plan/apply/rollback → audit
- [ ] 高级功能实测：health（温度/寿命）、mftscan（MFT 记录数）、dedup（≥1MB 重复组 + hardlink + rollback）、quota
- [ ] grep 确认无机器路径（`Administrator` / `D:\` 开发目录）
- [ ] **新开会话**才能看到新工具（静态插件会话挂载时注册，不热更新）——告知用户

### 2.8 插件发布进仓库

- 镜像已安装最新版 → `plugin/`（**以安装位置为基准**，product 源可能有旧副本，先比对哈希再镜像）。
- `plugin/README.md`：安装（复制到 `.agent-presets/<id>/`）/ 使用 / 安全模型 / 目录结构。
- 仓库主 README 补 Option C 链接（**不要用 `../README.md` 这种仓库外链接**）。

---

## 3. CLI 制作 SOP

### 3.1 构建

- `scripts/build-sea.ps1`：`esbuild bundle → node --experimental-sea-config → postject` 全离线；
  **脚本全 ASCII**（CI 用 pwsh7，中文会破坏字符串）。
- 版本常量 `VER` 在 `bin/disk-clean.js`；SEA 单入口，子进程自我调用走 `--internal-*` 参数，
  按 `IS_SEA`（`process.execPath` 含 `sea`）分派脚本路径。
- 依赖：Node 内建 `fs/crypto/child_process` + PowerShell 补齐系统能力（COM 快捷方式 / SMART / 计划任务），
  零运行时依赖。

### 3.2 验证清单

- [ ] 本地全量回归（scan / report / organize / clean / fix-shortcuts / audit / health / mftscan / dedup / quota）
- [ ] 重打包 exe 后**重新跑全命令**（exe 与源码永远同步）
- [ ] 版本 bump + CHANGELOG + ROADMAP 状态表同步
- [ ] 与插件侧同源文件比对（`lib/` ⇄ `plugin/plugins/dsk-lib/`）确认同步

---

## 4. GitHub 发布 SOP

### 4.1 认证（坑多，照做）

- `gh` 位于 `C:\Program Files\GitHub CLI\gh.exe`。
- **fine-grained PAT 不能用 `gh auth login --with-token`（报 401）**——用环境变量：
  `$env:GH_TOKEN = '<token>'`（每次 pwsh 调用前注入，变量不跨调用持久）。
- token 权限不足时不能创建仓库：明确列出选项（换 token / 手动建仓库）让用户选，不卡住。

### 4.2 提交规范

- 英文 commit message，单 commit 一个主题；文档与代码同步提交。
- 发布前：本地全量回归 → 版本 bump → commit → tag → Release 说明 → SHA256，**GitHub 只做搬运**。

### 4.3 Release 资产

```
disk-clean-win-x64.exe   （~82MB，gh release create 上传超时 → 后台任务跑）
SHA256SUMS.txt
checksums.txt            （version=<版本> 行）
```

- 产物哈希核对：`Get-FileHash`，与 Release 资产 updatedAt 后的哈希一致才算发布成功。
- Release 必须**非 draft**；CI workflow 手动验证（`gh workflow run` 在 CI 修复后重新触发，不删 tag 重推）。

### 4.4 CI 铁律

- 测试代码**禁止本机绝对路径**（CI 目录 `D:\a\...`），用仓库内相对路径 + 运行时自建测试树。
- 语法检查覆盖**全部** bin/lib/*.js（不只 4 个核心）。

### 4.5 发布检查清单

- [ ] `git status` 干净、`git log` 与 `ls-remote origin master` 一致
- [ ] Release 非 draft、资产哈希与本地一致
- [ ] CI 最新 run 成功
- [ ] README（Option A/B/C 链接）+ CHANGELOG + ROADMAP 无坏链接

---

## 5. 编码与 Windows 兼容铁律（最高频事故区）

1. 文件操作统一 **UTF-8 无 BOM**。PowerShell 5.1 `-Encoding UTF8` 会写 BOM 且按 ANSI 读入——
   中文必坏。用 Node 写文件或显式无 BOM 写法。
2. 跨进程输出（schtasks 等）：**严格 UTF-8 解码失败回退 GBK**
   （`TextDecoder('utf-8',{fatal:true})` → `TextDecoder('gbk')`）。
3. 脚本文件（build.ps1 / CI 脚本）**全 ASCII**。
4. PowerShell 调用：
   - 多行脚本**写 .ps1 + `-File` 调用**，绝不 `-Command` 传多行（参数被拆行）。
   - `cmd /c` 命令**整体包裹引号**：`cmd /c ""exe" args"`。
   - `&&` 是 pwsh7 语法——**PS 5.1 不支持**，用分号分隔。
   - Node 路径含反斜杠：**先存变量再 `& $var`**；含引号/反斜杠的 JSON 参数写文件传参或 `cmd /c` 包裹，
     不要直接内联（引号被剥）。
5. MFT 解析（NTFS 碎片）：
   - runlist 驱动读取，不假设连续；符号扩展/累加禁用 `<<` 32 位运算，用 `Math.pow`。
   - 稀疏/异常 size 兜底：`alloc ≤ real×2+4MB 用 alloc 否则 real`；size 超卷容量归 0。
   - 字段偏移以实测定准（DATA real@+48、FILE_NAME name@+66 等），改动后对照普通遍历验证（§3 PROCESS-REVIEW #5）。

---

## 6. 新会话复用指南（回答"新开会话还能不能用"）

**对话记忆不会带到新会话，但流程载体可以——用以下任一方式让新会话复用：**

1. **DSH 技能（推荐）**：本 preset 携带 `skills/release-sop/SKILL.md`，新会话的技能目录会自动出现
   「release-sop」；对模型说“按 release-sop 流程做 XXX”，即加载本手册的精简操作版。
2. **仓库文档**：直接要求模型读 `docs/RELEASE-PLAYBOOK.md`（本文件）+ `docs/PROCESS-REVIEW.md`
   （错误清单），命令示例：
   ```
   读取 D:\deepseekHerness\disk-clean-cli\docs\RELEASE-PLAYBOOK.md 和 PROCESS-REVIEW.md，
   按 §2 插件 SOP 把新功能 XXX 加入磁盘分析器插件并走 §4 发布流程。
   ```
3. **技能 = 指针，手册 = 权威**：SKILL.md 只放速查与定位（“读哪些文件、按哪几节做”），
   完整内容始终以仓库 docs/ 为准，避免两份文档漂移。

> 最佳实践：新会话开头先让它读本手册 + PROCESS-REVIEW，再开始动工；编码铁律（§5）每题必查。