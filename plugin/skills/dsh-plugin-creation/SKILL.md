---
name: dsh-plugin-creation
description: 从零创建一个 DSH（DeepSeek Harness）插件预设的全流程指南。覆盖目录结构、双形态（静态/动态）、agent.cordis.yml 编写、host.js 业务逻辑、辅助进程模式、client.js 图表面板、安全模型、常见坑与验证清单。当用户要求"创建 DSH 插件"、"做一个新预设"、"添加工具到 DSH"、"给 DSH 加功能"、"preset 怎么写"、"插件目录结构"时加载。与 cordis-plugin-development（动态插件 API 细节）和 editing-cordis-compositions（composition 编写规则）互补；本技能偏**从零到一的完整创建流程与经验沉淀**。
---

# DSH 插件创建全流程（从零到一）

> **权威文档**（本文件只放速查与流程，完整代码以仓库为准）：
> - `docs/RELEASE-PLAYBOOK.md §2`（插件制作 SOP）
> - `docs/PROCESS-REVIEW.md §7`（错误清单/复盘）
> - `skills/cordis-plugin-development/SKILL.md`（动态插件 API 细节）
> - `skills/editing-cordis-compositions/SKILL.md`（composition 编写规则）

## 零、先理解架构（两张图）

```
DSH 预设（Agent Preset）= 一个目录
├── preset.yml              ← 显示元数据（名称/描述/排序）
├── agent.cordis.yml        ← composition：声明挂载哪些插件/工具/skill/人格
├── plugins/
│   ├── <plugin-name>/
│   │   ├── host.js         ← 宿主半（动态模板，含 __DSK_DIR__ 占位）
│   │   ├── host.static5.js ← 宿主半（静态形态，agent.cordis.yml 直接引用，免审批）
│   │   ├── client.js       ← 客户端半（可选：对话流图表面板）
│   │   └── dsk-helper.js   ← 辅助进程（可选：原生 fs，不受沙箱限制）
│   ├── dsk-helper.js       ← 辅助进程（可选）
│   └── dsk-adv.js          ← 高级辅助进程（可选：MFT/dedup/quota）
├── skills/
│   └── <skill-name>/
│       └── SKILL.md        ← 技能文件（模型侧速查指南）
└── README.md               ← 可选说明
```

**两条路径选择：**

| 场景 | 选哪种形态 | 说明 |
|------|-----------|------|
| 只需要模型侧工具（无图表面板） | **静态** `host.static5.js` | agent.cordis.yml 直接引用，免 cordis_define/审批 |
| 需要对话流内图表面板 + 模型侧工具 | **动态** `host.js` + `client.js` | 需 cordis_define/cordis_run/GUI 审批 |
| 两者都要 | 静态 + 动态共存 | 静态提供工具，动态提供面板（互不冲突） |

## 一、目录结构（铁律）

### 预设安装位置

```
${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/
```

- **绝不编辑** 部署自带的 `agent-presets` 目录（升级会覆盖）
- 要改就**复制出来**编辑副本

### DSK_DIR 推导（宿主文件中最关键的一行）

```js
// host.static5.js — 静态形态
let DSK_DIR
try {
  const pathMod = require('node:path')
  DSK_DIR = pathMod.resolve(__dirname, '..', '..')  // 上溯两级 = preset 根
} catch (e) {
  DSK_DIR = 'C:\\Users\\Administrator\\.dsh\\.agent-presets\\<id>'  // 兜底
}
```

- `host.static5.js` 在 `plugins/<plugin-name>/` 下，上溯两级 = preset 根
- `host.js`（动态模板）用 `__DSK_DIR__` 占位，cordis_define 时替换
- **DSK_DIR 必须可写**——`.dsk-prog.json`/`.dsk-audit.json` 等运行时文件写在这里
- **绝不硬编码机器路径**（兜底值除外）——发布前 grep `Administrator`

### 辅助进程位置约定

```
plugins/
├── <plugin-name>/host.static5.js  ← 宿主引用 plugins/dsk-helper.js（上溯一级）
├── dsk-helper.js                  ← 辅助进程（原生 fs 遍历）
└── dsk-adv.js                     ← 高级辅助进程（MFT/dedup/quota）
```

宿主中引用路径：

```js
const HELPER = DSK_DIR + BS + 'plugins\\dsk-helper.js'
const ADV_HELPER = DSK_DIR + BS + 'plugins\\dsk-adv.js'
```

## 二、preset.yml（显示元数据）

```yaml
name: 我的插件名称
description: 一句话描述插件能力与适用场景
order: 90
```

- `name`：会出现在 DSH 预设选择器中
- `order`：排序权重（数字越小越靠前； shipped preset 用固定值）
- 无 `name` 时选择器显示裸目录名

## 三、agent.cordis.yml（composition 编写）

### 基本结构

```yaml
# 人格
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      You are a <描述> powered by the {{model}} model, running on the DeepSeek Harness.
      Your working directory is {{cwd}}.
      Load the `<skill-name>` skill before operating the plugin.
      Load the `editing-cordis-compositions` skill before writing or changing a composition.

# 基础工具（按需启用/禁用）
- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'

# 插件行（静态形态直接引用）
- id: my-plugin
  name: './plugins/my-plugin/host.static5.js'

# Skill 注册（必须有 customSkillDirs）
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
```

### 关键点

1. **persona 必须在最前面**（覆盖部署默认人格）
2. **plugin 行的 `name` 是相对路径**（相对于 preset 根目录）
3. **skill 注册必须有 `customSkillDirs`**——否则 `skill` 工具找不到你的 SKILL.md
4. **`baseUrl`** 是 preset 根目录的 URL（`!!js` 表达式自动解析）
5. **静态插件行直接引用 `host.static5.js`**——预设挂载时自动加载，免审批
6. **动态插件不写在 cordis.yml 里**——通过 `cordis_define` 在会话中安装

### 共存规则

- 你的预设可以和 `cordis`（创造模式）预设共存
- `tool-cordis` 是进程级单例——**不能在两个预设里同时挂载**
- 静态插件 + 动态插件可以并存（静态提供工具，动态提供面板）

## 四、host.js / host.static5.js（业务逻辑核心）

### 宿主插件骨架

```js
module.exports = {
  name: 'my-plugin',           // 插件名（唯一标识）
  inject: ['timer', 'tools'],  // 依赖的 Service（可选）
  apply(ctx) {
    const fs = ctx.get('fs')               // 可选 Service
    if (fs === undefined) return           // 防御性检查
    const subprocess = ctx.get('subprocess') // 可选 Service

    // ... 业务逻辑 ...

    // 注册 RPC 方法（Client ↔ Host 通信）
    harness.handle('my.method', doSomething)

    // 注册动态工具（模型侧调用）
    harness.registerTool(ctx, harness.defineTool({
      name: 'my_tool',
      description: '工具描述',
      parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
      output: { schema: { type: 'object', additionalProperties: true },
        render: function(args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      execute: async function(args) { return await doSomething(args) }
    }))

    // 清理函数（进程退出时调用）
    ctx.effect(function() { return function() { cancelled = true } })
    console.log('[my-plugin] ready')
  }
}
```

### 核心模式

| 模式 | 代码 | 说明 |
|------|------|------|
| 读文件 | `await fs.resolve(path)` → `await fs.readBytes(handle, undefined, maxBytes)` | `fs` Service，受沙箱限制 |
| 写文件 | `subprocess.spawn({ argv: [node, '-e', 'require("fs").writeFileSync(...)' ] })` | 绕开 ctx.fs 沙箱对新文件的限制 |
| 启动辅助进程 | `subprocess.spawn({ argv: [node, helper, ...args], cwd, stdio: {...} })` | 原生 fs，不受工作区限制 |
| 解析辅助进程输出 | `handle.collected.stdout.readFrom(0).text` → `lastIndexOf('\n')` → `JSON.parse` | 辅助进程最后一行 = JSON |
| 调 PowerShell | `subprocess.spawn({ argv: ['powershell.exe', '-NoProfile', '-EncodedCommand', b64] })` | UTF-16LE Base64 编码 |
| 审批 | `approval.request({ agent, toolName, reason })` → `'allowed-once'` | DSH 审批弹窗 |
| 注册工具 | `harness.registerTool(ctx, harness.defineTool({...}))` | 模型侧可调用 |
| 注册 RPC | `harness.handle('method.name', handler)` | Client ↔ Host 通信 |

### inject 声明规则

```js
// ✅ 正确：声明依赖的 Service
inject: ['timer', 'tools'],
apply(ctx) {
  const fs = ctx.get('fs')       // 可选 Service，用 get 读取
  // ctx.fs 是 inject 声明后才能用的（本例未声明 fs，所以用 get）
}

// ✅ 正确：硬依赖 Service（等待出现）
inject: ['fs'],
apply(ctx) {
  ctx.fs.resolve(...)  // inject 声明后可以直接用 ctx.xxx
}

// ❌ 错误：未声明就直接用 ctx.fs
apply(ctx) {
  ctx.fs.resolve(...)  // ReferenceError: ctx.fs is undefined
}
```

**铁律**：用 `ctx.get('xxx')` 读可选 Service；用 `inject: ['xxx']` 声明硬依赖后再用 `ctx.xxx`。

## 五、辅助进程模式（helper process）

辅助进程 = 独立 Node 脚本，通过 `subprocess.spawn` 调用，**不受 ctx.fs 工作区限制**。

### 输出协议

```js
// 辅助进程最后一行 stdout = 聚合 JSON
function out(obj) {
  process.stdout.write('\n' + JSON.stringify(obj))
}
// 调用方解析
async function parseHelperOut(handle) {
  const read = handle.collected.stdout.readFrom(0)
  const text = read.text
  const idx = text.lastIndexOf('\n')
  return JSON.parse((idx >= 0 ? text.slice(idx + 1) : text).trim())
}
```

### 辅助进程参数约定

```
node dsk-helper.js --roots "C:\;D:\" --exclude "x;y" --progress <file> --report <file> [--time] [--suggest]
node dsk-helper.js --dir <path>
node dsk-adv.js mftscan <盘符>
node dsk-adv.js dedup <rootsJson> [minBytes]
```

### 调用方（宿主）模板

```js
async function runHelper(args) {
  const node = await ensureNode()  // 找 node 路径
  const handle = subprocess.spawn({
    argv: [node, HELPER, ...args],
    cwd: CWD,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 64 << 20 }, stderr: { maxBytes: 1 << 20 } },
    graceMs: 5000
  })
  const outcome = await handle.done.catch(function() { return null })
  if (!outcome) return { ok: false, error: '辅助进程异常退出' }
  const parsed = await parseHelperOut(handle)
  return parsed
}
```

### 找 Node 路径

```js
let NODE = null
async function ensureNode() {
  if (NODE) return NODE
  if (subprocess && subprocess.resolveExecutable) {
    try { NODE = await subprocess.resolveExecutable('node') } catch (e) { /* fallback */ }
  }
  if (!NODE) NODE = 'C:\\Program Files\\nodejs\\node.exe'  // 兜底
  return NODE
}
```

### 写文件（绕沙箱）

```js
async function writeTextFile(p, content) {
  const node = await ensureNode()
  const handle = subprocess.spawn({
    argv: [node, '-e', 'const fs=require("fs");fs.writeFileSync(process.argv[1],process.argv[2],"utf8");', p, content],
    cwd: CWD,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 16 }, stderr: { maxBytes: 1 << 16 } },
    graceMs: 5000
  })
  const outcome = await handle.done.catch(function() { return null })
  if (!outcome) throw new Error('写文件子进程异常退出')
}
```

### 调 PowerShell（编码铁律）

```js
async function runPowerShell(script) {
  const b64 = utf16leB64(script)  // UTF-16LE Base64 编码
  const handle = subprocess.spawn({
    argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
    cwd: CWD,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 20 }, stderr: { maxBytes: 1 << 20 } },
    graceMs: 5000
  })
  // ...
}
function utf16leB64(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    bytes.push(c & 0xFF, (c >> 8) & 0xFF)
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.slice(i, i + 8192))
  }
  return btoa(bin)
}
```

## 六、client.js（对话流图表面板，可选）

### 骨架

```js
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 注入 CSS 样式（必须用 styles.insert，返回 disposer）
    const dis = styles.insert('.my-panel{...}')
    ctx.effect(function() { return dis })  // 进程退出时清理

    // 定义面板组件（React.createElement，不用 JSX）
    function MyPanel() {
      const [st, set] = React.useState({ data: null })
      React.useEffect(function() {
        host.call('my.method', {}).then(function(r) { set({ data: r }) })
        return undefined
      }, [])
      return React.createElement('div', { className: 'my-panel' }, ...)
    }

    // ⚠️ 关键：必须用 slots.inject → slots.register 双层调用
    slots.inject('tool.view.cordis', function() {
      return slots.register(
        { name: 'tool.view.cordis', key: 'self' },
        function(props) { return React.createElement(MyPanel) }
      )
    })
  }
}
```

### ⚠️ 切换插件点击不进去的根因

**必须用 `slots.inject` 包裹 `slots.register`**。如果直接调用 `slots.register` 而没有外层 `slots.inject`，DSH Web GUI 的插件切换按钮**不会响应点击**——这是最常见的"点击不好使"根因。

```js
// ❌ 错误：直接 register，切换点击不响应
slots.register({ name: 'tool.view.cordis', key: 'self' },
  function(props) { return React.createElement(MyPanel) })

// ✅ 正确：inject 包裹，点击正常
slots.inject('tool.view.cordis', function() {
  return slots.register(
    { name: 'tool.view.cordis', key: 'self' },
    function(props) { return React.createElement(MyPanel) }
  )
})
```

### RPC 通信（Client → Host）

```js
// Client 调用 Host 方法
const result = await host.call('scan.start', { roots: ['D:\\'] })
const status = await host.call('scan.status', {})
const report = await host.call('report.get', {})
```

Host 端注册对应方法：

```js
harness.handle('scan.start', doStart)
harness.handle('scan.status', doStatus)
harness.handle('report.get', doReport)
```

### 样式铁律

- 用 `styles.insert(cssString)` 注入（返回 disposer）
- **必须在 `ctx.effect` 中返回 disposer**（进程退出时清理）
- CSS 变量用 `var(--text-1, #e8e8e8)` 兜底（暗色主题兼容）
- 字体用 `system-ui, sans-serif`（跨平台）

## 七、安全模型

### 三层防护

1. **DSH 审批**：所有删除/移动操作必须调 `approval.request`，用户在 GUI 点"批准"才执行
2. **白名单校验**：清理路径必须来自最近一次扫描报告的建议清单（`validateCleanArgs`）
3. **审计日志**：每次操作写入 `.dsk-audit.json`（时间/类型/路径/结果）

### 审批调用模板

```js
async function askApproval(reason) {
  const agents = ctx.get('agents')
  const approval = ctx.get('approval')
  if (!agents || !approval) return { err: '审批服务不可用' }
  const agent = agents.currentInitiator()
  if (!agent) return { err: '无法确定当前会话' }
  const outcome = await approval.request({ agent: agent, toolName: 'my_tool', reason: reason })
  if (outcome !== 'allowed-once') return { err: '用户未批准（' + String(outcome) + '）' }
  return {}
}
```

### 安全区域判定

```js
const SYS_PREFIX = ['\\windows\\', '\\program files\\', '\\program files (x86)\\',
                    '\\programdata\\', '\\winsxs\\', '\\system volume information\\', '\\$recycle.bin\\']
function isSafeZone(lowerPath) {
  return SYS_PREFIX.every(function(pre) { return lowerPath.indexOf(pre) < 0 })
}
```

### 回收站优先

```js
// 移入回收站（可恢复）而非永久删除
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, "OnlyErrorDialogs", "SendToRecycleBin")
```

## 八、常见坑速查（每题必查）

| # | 坑 | 根因 | 修复 |
|---|-----|------|------|
| 1 | 工具注册了但模型看不到 | `harness.registerTool(ctx, tool)` 缺 ctx | 两个参数都传 |
| 2 | `ctx.fs` undefined | 未声明 `inject: ['fs']` | 用 `ctx.get('fs')` 或声明 inject |
| 3 | 辅助进程输出解析失败 | stdout 混入非 JSON 行 | 取 `lastIndexOf('\n')` 之后 |
| 4 | 写文件被沙箱拒绝 | `ctx.fs` 受工作区限制 | 用 subprocess spawn 写 |
| 5 | PowerShell 中文乱码 | UTF-8 被 GBK 读取 | `-EncodedCommand` + UTF-16LE Base64 |
| 6 | 切换插件点击不进去 | Client 缺 `slots.inject` 包裹 | `slots.inject('tool.view.cordis', function() { return slots.register(...) })` |
| 7 | 预设选择器显示裸目录名 | 缺 `preset.yml` | 加 `name` + `description` |
| 8 | Skill 找不到 | 缺 `customSkillDirs` | cordis.yml 加 `skill-filesystem` 行 + `baseUrl` |
| 9 | DSK_DIR 指向错误 | 辅助进程路径算错 | 静态：`__dirname` 上溯两级；动态：`__DSK_DIR__` 替换 |
| 10 | 硬编码机器路径 | 被发布覆盖/新机器找不到 | 用 DSK_DIR 变量 + 兜底值 |
| 11 | Node 路径找不到 | SEA 打包后 `process.execPath` 是 exe | `subprocess.resolveExecutable('node')` + 兜底 |
| 12 | 进程退出后残留状态 | 未注册 cleanup | `ctx.effect(function() { return function() { cancelled = true } })` |
| 13 | Client React 用 JSX | 不支持 JSX 编译 | 用 `React.createElement(...)` |
| 14 | `styles.insert` 未清理 | 样式残留 | `ctx.effect(function() { return dis })` |
| 15 | PowerShell 脚本中文注释 | BOM-less UTF-8 被 ANSI 错读 | 脚本全 ASCII 注释 |
| 16 | Inno 同 AppId 沿用旧安装目录 | E2E 残留被当成正式安装 | 正式安装前卸载旧注册 + 显式 `/DIR="C:\Program Files\xxx"` |
| 17 | Start-Process 参数拆断 | 数组按空格拆分 | 传整体字符串含引号 |
| 18 | 盘符容量显示 24KB | `statSync(root).blocks` 是根目录块数 | 用 `fs.statfsSync` 真实容量 |

## 九、验证清单

### 开发态（直跑）

1. `node --check` 全部 js 文件（语法）
2. `node bin/<xxx>.js serve` 启动服务层
3. curl / API 冒烟（health/drives/scan/...）
4. Edge headless 渲染（`--headless=new --user-data-dir=<临时>`）

### 插件态（DSH 会话）

1. 预设挂载 → persona 生效（对话开头显示插件描述）
2. `skill` 工具能找到你的 SKILL.md
3. 模型侧工具全部可调用（`disk_scan` cmd=drives 返回真实数据）
4. 辅助进程正常运行（`dsk-helper.js` 扫描产出 JSON）
5. 审批流程正常（删除/移动弹出 DSH 审批）
6. 客户端面板渲染正常（如果有的话）

### 发布态

1. 预设目录复制到安装位置 → 重启 DSH → 工具可用
2. 仓库 plugin/ 目录同步（哈希一致）
3. README 同步（工具列表/使用示例）
4. 新会话挂载验证（"新开会话还能不能用"）

## 十、关键文件指针

| 想看什么 | 读哪个 |
|---|---|
| 预设目录结构 | `product/<id>/` 或 `~/.dsh/.agent-presets/<id>/` |
| Composition 编写 | `agent.cordis.yml` + `skills/editing-cordis-compositions/SKILL.md` |
| 动态插件 API | `skills/cordis-plugin-development/SKILL.md` |
| 插件制作 SOP | `docs/RELEASE-PLAYBOOK.md §2` |
| 错误清单 | `docs/PROCESS-REVIEW.md §7`（G1–G45） |
| 安全模型 | `host.js` 中的 `validateCleanArgs` + `askApproval` |
| 辅助进程 | `plugins/dsk-helper.js`（原生 fs 遍历 + 建议引擎） |
| 高级功能 | `plugins/dsk-adv.js`（MFT/dedup/quota） |
| Client 面板 | `plugins/<name>/client.js`（React.createElement + Slot 注册） |

## 十一、从零到一的步骤清单

```
1. 创建预设目录
   mkdir ~/.dsh/.agent-presets/<id>/
   mkdir ~/.dsh/.agent-presets/<id>/plugins/<plugin-name>/
   mkdir ~/.dsh/.agent-presets/<id>/skills/<skill-name>/

2. 写 preset.yml（名称/描述/排序）

3. 写 agent.cordis.yml
   - persona（人格 + 指令）
   - 基础工具（shell/fs/jobs/goals）
   - 插件行（静态引用 host.static5.js）
   - skill 注册（customSkillDirs + baseUrl）

4. 写 host.static5.js
   - DSK_DIR 推导
   - 辅助进程路径
   - 工具注册（harness.defineTool + harness.registerTool）
   - RPC 注册（harness.handle）
   - cleanup（ctx.effect）

5. 写辅助进程（如果需要原生 fs）
   - 参数解析
   - 业务逻辑
   - 最后一行 stdout = JSON

6. 写 client.js（如果需要图表面板）
   - styles.insert + ctx.effect 清理
   - React.createElement 组件
   - slots.inject → slots.register 双层注册
   - host.call RPC 通信

7. 写 SKILL.md（模型侧速查指南）

8. 验证
   - node --check 全部 js
   - DSH 会话挂载 → 工具可调用 → 面板可渲染
   - 新会话复用验证
```
