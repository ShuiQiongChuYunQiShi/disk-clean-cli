---
name: disk-analyzer
description: 安装并操作 Windows 磁盘分析器插件（磁盘扫描/分类/建议/清理）。当用户要求分析磁盘空间、扫描大文件、清理垃圾、删除重复文件、整理磁盘、查看回收站占用、找空间被谁占用时使用。
---

# Windows 磁盘分析器（Disk Analyzer）

基于 DeepSeek Harness 动态 Cordis 插件 + 独立 Node 辅助进程（dsk-helper.js）的
Windows 磁盘清理与分析工具。**先安装（一次），后使用。**

## 一、安装与激活（本预设自动完成，无需手动安装）

本预设的 `agent.cordis.yml` 含静态插件行
`name: './plugins/disk-analyzer/host.static5.js'`——预设挂载时插件自动加载，
**无需 cordis_define / cordis_run / GUI 审批**。

- 引擎：`plugins/dsk-helper.js`（宿主通过 node 子进程调用）
- 状态文件：`.dsk-prog.json` / `.dsk-audit.json` / `.dsk-organize-plan.json` /
  `.dsk-organize-map.json` 写入预设目录
- 进程重启后：预设重新挂载，插件自动恢复（8 个工具重新注册）

验证：`disk_scan` cmd=drives 应返回盘符与容量。

> 说明：本静态形态提供**模型侧工具 + 文本报告**；交互式**图表面板**（GUI 对话流内
> 的环图/横条/下钻）由动态插件版本提供（在 cordis 会话中用 cordis_define 安装，
> 进程内有效），两者可并存。本预设与 `cordis`（创造模式）预设共存，互不冲突。

## 二、使用（对话流 + 工具）

### 模型侧工具（本轮已注册，直接调用）

- `disk_scan` — 磁盘扫描与查询：
  - `cmd=drives`：列出本地盘符与容量
  - `cmd=start` `roots=["C:\\","D:\\"]`：启动扫描（省略 roots 扫全部本地盘；
    `suggest=false` 可关闭建议分析以加速；`exclude` 可排除路径）
  - `cmd=status`：查询扫描进度（文件/目录/字节/当前路径）
  - `cmd=report`：取聚合报告（分类/扩展名/大目录/大文件/垃圾点/时间分布/**智能建议**），
    同时返回 `markdown` 字段（可读 Markdown 详细报告：概览表/类别统计+比例条/大文件
    Top10/大目录 Top10/建议表格，也已落盘为 `.md` 文件，可直接展示给用户）
  - `cmd=dir` `path=...`：下钻目录（子目录+文件 Top N）
  - 扫描同时**检测散落目录**（盘根与用户区根部的第一层目录，修改 >30 天 且 ≥100MB），
    报告 suggestions 含 `organize-folders` 建议（loose 类可整理 / program 类程序目录
    仅提示，标注快捷方式失效风险）
- `disk_clean` — 清理执行（**默认只建议不执行**）：
  - `type=recycle-bin`：清空回收站（永久删除，不可恢复，estBytes 来自建议）
  - `type=junk-temp/empty-dirs/duplicates`：把 `paths`（**必须取自最近一次报告的
    建议明细**）移入回收站
  - 执行前会弹出 **DSH 审批**，用户批准后才真正执行；写入审计日志
- `disk_organize` — 磁盘整理（**不删除文件，移动可回滚**）：
  - `cmd=plan` `includeProgram=true|false`：生成整理计划（只读预览）。**目录候选**来自
    扫描报告 `organizeCandidates`（A 类散落目录，判定在引擎一处），**文件候选**来自用户区
    Downloads/Desktop/Documents 等根目录下的散落文件；均按类型归入
    `<盘>:\整理区\<分类>\`。默认**不包含**程序/游戏目录（program 类）；`includeProgram=true`
    时追加 program 候选（⚠ 标注快捷方式失效风险 + `fixShortcuts` 建议）
  - `cmd=apply` `items=[{src,dst,kind,fixShortcuts}]`：执行整理（审批后移动，**支持目录**，
    目录跨盘时递归复制+删除；目标必须位于盘符根下的整理区；写入映射文件供回滚）。
    **program 目录必须 `fixShortcuts=true` 才能移动**；启用后移动完成自动重写桌面/开始菜单/
    任务栏指向旧路径的快捷方式（.lnk），修改记录挂入映射，随 rollback 一并恢复
  - `cmd=rollback`：回滚最后一批整理（移回原位置 + 恢复快捷方式，需审批）
- `disk_audit` — 读取清理/整理审计日志（时间/类型/路径/结果）
- `disk_health` — 磁盘健康检查（无参数）：读取所有物理盘 SMART 数据
  （Get-PhysicalDisk + Get-StorageReliabilityCounter）：温度/SSD 寿命/通电小时/
  读写错误，给出健康分级（健康/注意/警告/危险 + 具体问题列表）。结果落盘
  `.dsk-health.json`。示例：`disk_health` → 每块盘的 温度/寿命/健康等级。
- `disk_mftscan` — MFT 直读快速扫描：`cmd=scan` `drive="D:"` 直接读取 NTFS
  `$MFT` 元数据（WizTree 思路，~8x 提速；需管理员权限，非 NTFS 或权限不足报错）。
  返回概要/分类/大目录 Top/大文件 Top。
- `disk_dedup` — 全盘重复文件检测与硬链接合并：
  - `cmd=scan` `roots=["C:\\","D:\\"]`：检测重复文件（排除系统/程序目录，≥1MB，
    head/tail 两阶段哈希），返回重复组 + 可释放空间
  - `cmd=hardlink` `groups=[...]`：将重复组转硬链接省空间（保留每组第一个；
    **需 DSH 审批**，可回滚；groups 取自 scan 输出）
  - `cmd=rollback`：回滚硬链接合并（恢复为独立副本，需审批）
- `disk_quota` — 每用户配额分析：`cmd=analyze` `drive="C:"` 基于 MFT 直读的
  目录占用聚合，按 `C:\Users\*` 前缀分组统计每个用户的磁盘占用与子目录明细
  （需管理员权限）。

### 浏览器面板（动态插件 Client 半区，tool.view.cordis Run 卡内）

- 实时状态：扫描中显示进度（已统计/文件/目录/已用时间/当前路径），完成自动刷新
- 概览卡片：总大小/文件数/目录数/耗时/建议可释放空间
- 可视化图表：类别占比 **SVG 饼图**（含图例）、大目录 Top8 **横向条形图**
- 建议表：智能建议列表（风险着色）、目录整理候选（可整理 / 程序目录仅提示）
- 数据经 `host.call('scan.status'/'report.get')` 获取；面板仅当前运行会话可见，
  不影响静态预设用户；静态 preset 用户使用 Markdown 报告 + 对话表格

### 典型流程

```
用户: 磁盘满了，帮我看看
1. disk_scan cmd=drives
2. disk_scan cmd=start roots=["C:\\"]          # 全盘扫描 ~60s（含建议分析，优化后）
3. disk_scan cmd=report                         # 紧凑摘要 + markdown 详细报告（可直接展示）
4. 向用户展示建议（风险/可释放/明细），询问清理意向
5. 用户确认后 disk_clean type=... paths=[建议中的路径]  → DSH 审批 → 执行
6. disk_audit 展示审计结果

用户: 下载文件夹太乱了，整理一下
1. disk_scan cmd=start roots=["C:\\"]          # 先扫描（整理基于扫描范围）
2. disk_scan cmd=report                         # 报告含 organize-folders 建议（散落目录）
3. disk_organize cmd=plan                        # 只读预览整理计划（目录 + 文件）
4. 向用户展示计划（目录/文件 → 目标分类），确认
5. disk_organize cmd=apply items=[计划项]       → DSH 审批 → 移动（支持目录）
6. 不满意时 disk_organize cmd=rollback          → DSH 审批 → 移回原位置

用户: 把这些程序目录也整理一下（如 D:\WeGameApps）
1. disk_organize cmd=plan includeProgram=true    # 追加程序目录候选（⚠ 快捷方式风险）
2. 向用户说明：program 目录移动会破坏安装/快捷方式，仅建议在确认后移动
3. disk_organize cmd=apply items=[{kind:'program',fixShortcuts:true,...}]
   → DSH 审批 → 移动 + 自动重写快捷方式（可回滚）
```

> **报告输出（G 优化）**：`cmd=report` 返回紧凑摘要（分类/扩展名 Top20、大目录/大文件
> Top30、建议明细）+ **Markdown 详细报告**（`markdown` 字段，同目录 `.md` 文件），完整
> JSON 由引擎写入 `reportFile` 字段指向的文件（预设目录 `.dsk-report.json`），需要全部
> 明细（如全部空目录、Top100 文件）时用 `read` 工具读取该文件。这避免了 233KB 超大
> JSON 经工具输出通道截断损坏的问题。

## 三、安全准则（强制）

1. **只读优先**：扫描/报告/下钻全部只读；删除与移动必须显式用户确认 + DSH 审批。
2. **回收站优先**：所有删除先移入回收站（可恢复）；仅 recycle-bin 类型永久删除。
3. **白名单**：清理路径必须来自最近一次报告的**建议明细**（duplicates 的
   removable、empty-dirs 清单、temp 段判定）；否则宿主拒绝。
4. **系统目录保护**：`Windows`、`Program Files`、`ProgramData`、`WinSxS`、
   `System Volume Information`、`$Recycle.Bin` 只统计不清理（duplicates 严格拒绝）。
5. **不可逆操作提示**：清空回收站 = 永久删除，向用户明确说明再执行。
6. **审计**：每次执行写入 `.dsk-audit.json`（时间/类型/路径/字节/结果），可随时
   `disk_audit` 查询。

## 四、性能与输出（A-G 优化，v2 引擎）

| 优化 | 说明 | 效果 |
|---|---|---|
| A 阈值提升 | 重复检测最小 1MB（原 512B） | 候选 73.4万 → 4,494（-99.4%） |
| B 并发哈希 | 建议阶段复用 64 并发池（原串行） | 哈希阶段提速 5-10 倍 |
| C 用户区限定 | 去重仅扫描 Downloads/Documents/Desktop/Pictures 等 | 与清理白名单一致，杜绝白做 |
| D 游戏库跳过 | Steam/WeGame/Epic 等目录仅统计大小，不做深度分析 | 报告更干净、避免误导建议 |
| E 两阶段哈希 | 先 head 命中再 tail，命中才全哈希 | 再省一半读取 |
| F stat 并行 | 目录内文件 stat 并发 | 遍历提速 |
| G 输出落盘 | 完整 JSON 写入 `.dsk-report.json`，工具只回紧凑摘要 | 修复超大 JSON 通道截断损坏 |
| H 散落目录检测 | 盘根与用户区根部的第一层目录，修改 >30 天 且 ≥100MB，分 A（可整理）/B（程序仅提示） | 报告新增「目录整理建议」，可一键整理（H 为本轮新增） |
| I 可读报告 | `report` 返回 Markdown 详细报告 + 落盘 `.md` 文件（概览/类别比例条/大文件/建议表格） | 对话直接渲染表格，无需 read JSON |
| J 快捷方式修复 | program 目录 `fixShortcuts` 移动后自动重写桌面/开始菜单/任务栏 .lnk，记录入映射可回滚 | plan 含风险标注；apply 强制 fixShortcuts；rollback 一并恢复 |
| K 可视化面板 | 动态插件 Client 半区（tool.view.cordis）：SVG 饼图/大目录条形图/建议表，扫描中实时进度 | 仅当前运行会话可见，静态用户不受影响 |

> 实测（D 盘 1,368,244 文件 / 631GB）：**总耗时 1225 秒 → 56 秒（约 22 倍）**，
> 且重复检测在用户区发现约 1.09GB 真实重复（此前小文件阈值下几乎无收益）。

## 五、故障排查

| 症状 | 原因与处理 |
|---|---|
| `请先完成扫描` | 插件进程重启后扫描状态丢失；重新 `disk_scan cmd=start` |
| `路径不在建议清单中` | 清理路径与最近一次报告的建议明细不一致；先 report 再取明细 |
| `路径不在扫描范围内` | 路径超出本次 roots；扩大扫描范围或缩小清理清单 |
| `用户未批准清理操作` | 审批被拒；向用户说明原因后由用户决定是否重试（不自动重试） |
| 扫描慢/无进度 | 首次全盘扫描含建议分析（哈希去重）较慢；可用 `suggest=false` 快速扫描 |
| 面板不显示 | 客户端未激活；刷新页面，或 cordis_run 后等待客户端激活 |
| `resolveExecutable` 失败 | node 不在 PATH；在宿主代码 ensureNode 中写死 node.exe 绝对路径 |
| 报告 JSON 尾部损坏 | 已修复（G）：工具输出为紧凑摘要，完整 JSON 在 reportFile 指向的文件 |

## 六、二期能力（规则引擎 8 类建议）

| 建议 | 风险 | 说明 |
|---|---|---|
| 清理临时与缓存文件 | 低 | 临时目录/浏览器缓存/预读取等，可重新生成 |
| 删除空文件夹 | 低 | 仅建议，实际删除走审批 |
| 删除重复文件 | 中 | 仅用户区（Downloads/Documents/Desktop/Pictures 等），保留最短路径 |
| 清理陈旧大文件 | 中 | ≥500MB 且 2 年未修改（提示类） |
| 创建时间久远的历史目录 | 低 | 用户区目录内全部文件创建 >730 天（提示类） |
| 卸载残留检查 | 高 | AppData/ProgramData 残留目录（需注册表交叉验证，人工确认） |
| 清空回收站 | 高-不可逆 | 永久删除，需明确授权 |
| 目录整理建议 | 低（A 类可移动）/提示（B 类） | 散落目录检测：A 类（杂物/文档/项目）建议归入 `整理区\<分类>`，可 `disk_organize plan` 一键整理；B 类（程序/游戏目录，含 exe 特征或盘根目录名匹配）仅提示不移动 |

规则库位于引擎 `dsk-helper.js` 顶部常量（EXT_CAT/EXT_JUNK/DIR_CAT_RULES/JUNK_RULES/
阈值），可编辑后重新定义插件版本以生效（cordis_define existing 追加 package）。
