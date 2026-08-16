# disk-clean 制作与发布全流程复盘

> 记录时间：2026-08-16 · 项目：disk-clean v0.2.0（Windows 磁盘清理与分析 CLI，MIT 开源）

---

## 一、项目概览

- **起点**：DeepSeek Harness（DSH）插件形态的磁盘清理分析引擎
- **终点**：独立开源 CLI 仓库 https://github.com/ShuiQiongChuYunQiShi/disk-clean-cli
- **形态**：零 npm 运行时依赖（Node 内建 + PowerShell），Node SEA 单文件 EXE（82MB）
- **安全模型**：破坏性操作一律 dry-run 默认，`--yes` 才执行；垃圾入回收站；移动可回滚（含快捷方式重写）；系统路径始终拒绝；审计日志 JSONL

---

## 二、完整流程时间线（12 个 Phase）

| 阶段 | 核心交付 | 关键验证 |
|---|---|---|
| 0-1 | 独立仓库骨架 + ROADMAP | --help 可用 |
| 2 | **SEA 单文件 EXE**（替代 pkg） | 全离线打包成功，82MB |
| 3 | 英文 README + MIT + CI + CONTRIBUTING | git 仓库就绪 |
| 4 | 规则配置 config（阈值/exclude） | 20MB 测试目录验证阈值生效 |
| 5 | 定时任务 schedule（schtasks） | node + SEA 双环境端到端触发，报告归档 |
| 6 | **MFT 直读快速扫描**（最复杂） | 5.5s vs 43.1s（~8x），文件数 99%/目录 100% 一致 |
| 7 | SMART/SSD 健康 health | 双 SSD 实测，57°C 触发"注意"分级 |
| 8 | 全盘哈希 dedup + 硬链接合并 | D 盘 35s / 1503 组 / 可释放 17.3GB；LinkType 验证 |
| 9 | 每用户配额 quota | C 盘 administrator 1.1TB/74.9% + 子目录明细 |
| 10 | 系统还原点 --restore-point | 24h 频率限制时降级提示明确、不中断 |
| 11 | i18n 报告 --lang en\|zh | 双语报告实测 |
| 12 | **GitHub 发布** | 仓库 + Release v0.2.0（exe+SHA256SUMS）+ CI 绿 |

**最终指标**：12 个 commit、2 个 tag、CI 48s 全绿、Release 资产 86MB exe。

---

## 三、可复用借鉴的经验（方法论）

### 3.1 技术选型
1. **Node SEA 替代 pkg**：`@yao-pkg/pkg` 需要 GNU patch + 从源码编译 Node（缺 NASM），SEA 用 `esbuild bundle → node --experimental-sea-config → postject 注入` 全离线完成。零依赖开源工具优先选"纯 Node + 官方运行时"路线。
2. **零运行时依赖**：Node 内建 `fs/crypto/child_process` + PowerShell 补齐系统能力（COM 快捷方式、SMART、任务计划）。分发成本低、审计透明。
3. **SEA 单入口限制**：子进程自我调用 `--internal-scan`（`process.execPath` 区分 SEA/node 环境），避免多入口打包。

### 3.2 工程方法
4. **分阶段 ROADMAP + 每阶段验收记录**：12 个 phase 每步"实现 → 实测 → 记录"，状态表随进度更新，阶段间零返工。
5. **对比验证法**（Phase 6 关键）：MFT 结果与普通遍历逐项对照（文件数/目录数/总大小），数字说话，不靠"看起来对"。
6. **测试树构造**：`.dsk-test` 固定结构（散落目录/重复文件/空目录/垃圾）快速复现阈值与逻辑，真实盘只做最终验收。
7. **后台任务 + 收集**：长操作（全盘扫描 35s、exe 上传 82MB、winget 安装）一律后台跑，job_output 收结果，不阻塞主线。
8. **每阶段产物闭环**：功能完成 → 重打包 exe → 全命令回归 → git commit。exe 与源码永远同步。

### 3.3 兼容性铁律（Windows 特有）
9. **编码三原则**：
   - 所有文件操作统一 **UTF-8 无 BOM**（PowerShell 5.1 的 `-Encoding UTF8` 是带 BOM 且按 ANSI 读入，会损坏中文！）
   - 跨进程输出（schtasks 等）**严格 UTF-8 解码失败回退 GBK**（`TextDecoder('utf-8',{fatal:true})` → `TextDecoder('gbk')`）
   - **脚本文件全 ASCII**（CI 用 pwsh7，中文会因编码错乱破坏字符串终止符）
10. **PowerShell 调用铁律**：
    - 多行脚本**写 .ps1 文件 + `-File` 调用**，绝不 `-Command` 传多行字符串（参数会被拆行）
    - `cmd /c` 命令**整体包裹引号**（`cmd /c ""exe" args"`），否则首尾引号被剥离
    - Node 路径含反斜杠时**先存变量再 `& $var`**，直接内联会被转义破坏
11. **MFT 直读经验**（NTFS 碎片场景）：
    - **runlist 驱动读取**，不要假设 MFT 连续（实测 8 个碎片 run 散布 3GB-638GB，含物理回跳）
    - runlist 符号扩展与累加**禁止 `<<` 32 位运算**，用 `Math.pow`/乘法
    - FILE 记录：属性头 `type@0/len@4/nr@8`；resident 值 `vLen@+16/vOff@+20`；non-resident **alloc@40/real@48/init@56**
    - FILE_NAME：`parentRef@0、nameLen@+64、namespace@+65、name@+66`（UTF-16LE）
    - **稀疏/异常文件 size 兜底**：`alloc ≤ real×2+4MB 用 alloc 否则 real`；**size 超卷容量归 0**（磁盘占用口径）

### 3.4 发布流程
12. **发布前本地全量回归 + 版本 bump + tag + Release 说明 + SHA256**，GitHub 只做搬运。
13. **CI 必须"离线可移植"**：测试代码禁止本机绝对路径（CI 目录是 `D:\a\...`），用仓库内相对路径 + 运行时自建测试树。
14. **CI 里修复 → 重新手动触发 workflow 验证**（`gh workflow run`），不删 tag 重推。

---

## 四、犯过的错误清单（含修复）

### 4.1 打包/运行时
| # | 错误 | 根因 | 修复 |
|---|---|---|---|
| 1 | pkg 打包失败 | 需 GNU patch + 源码编译 Node（缺 NASM） | 切 Node SEA（esbuild+postject） |
| 2 | `node.exe bad option: --internal-scan` | spawn 缺脚本路径参数 | `selfArgs` 按 IS_SEA 分派（node 环境带 `__filename`） |
| 3 | 定时任务 exit 1 | `cmd /c "a" "b"` 剥离首尾引号 | 整体包裹 `cmd /c ""a" "b"...` |
| 4 | 任务命令入口错 | `__filename` 指向 lib/schedule.js | `path.join(__dirname,'..','bin','disk-clean.js')` |

### 4.2 编码（最高频事故区）
| # | 错误 | 根因 | 修复 |
|---|---|---|---|
| 5 | schtasks 输出乱码 | 中文系统 GBK 字节按 UTF-8 解码 | 严格 UTF-8 失败回退 GBK |
| 6 | schtasks CSV 误配 | 正则匹配错 | 引号 CSV 解析器 parseCsvLine |
| 7 | **pwsh Set-Content 损坏文件**（最严重） | PS 5.1 `-Encoding UTF8` 按 GBK 读入 + 写 UTF-8 BOM，中文全乱 | git 从干净 commit 恢复 + Node 写文件（UTF-8 无 BOM） |
| 8 | **git checkout 恢复的是污染版** | 乱码 commit 已入库（bf0805a） | 从更早干净 commit（760f94b）恢复 |
| 9 | build-sea.ps1 CI 报"字符串终止符缺失" | 中文在 pwsh7 下编码错乱，`0x92` 变成 `'` | 脚本全 ASCII 重写 |
| 10 | node -e 内联脚本引号被破坏 | pwsh here-string 与 JS 字符串引号冲突 | 改用独立脚本文件执行 |

### 4.3 MFT 解析（连环坑）
| # | 错误 | 修复 |
|---|---|---|
| 11 | 扫描无边界读卷尾（1TB）超时 | rec0 解析 $MFT 大小/runlist 作边界 |
| 12 | DATA size 偏移 +56 错 | 实为 real@+48（alloc@40/init@56） |
| 13 | FILE_NAME 偏移连环错（vp+24/+26、nameLen+62） | 修正为 +16/+20、nameLen@+64、name@+66 |
| 14 | **parentRef 全 null 但 name 正常**（最难排查） | 重构时局部变量未写回 `out.parentRef` |
| 15 | runlist LCN 负数 | 符号扩展 `1 << 32` 溢出 → `Math.pow` |
| 16 | 稀疏文件 real 42PB 污染 totalBytes | alloc/real 合理性规则 |
| 17 | 系统文件 alloc 字段垃圾（2.5PB） | `alloc ≤ real×2+4MB 用 alloc 否则 real` |
| 18 | C 盘 quota 25PB（稀疏 journal） | **size 超卷容量归 0** |

### 4.4 系统调用/发布
| # | 错误 | 修复 |
|---|---|---|
| 19 | PowerShell 多行 -Command 参数被拆行 | .ps1 文件 + -File |
| 20 | restore point `$args[0]` 为 null | 同上（-File 模式 $args 可靠） |
| 21 | fine-grained token 不能创建仓库 | 用户换新 token（或手动建仓库） |
| 22 | gh release create 上传 82MB 超时 | 后台任务跑 |
| 23 | CI smoke test 绝对路径 MODULE_NOT_FOUND | 仓库内可移植测试树 |
| 24 | CI 语法检查只覆盖 4 个 lib | 扩展为全部 bin/lib/*.js |

### 4.5 流程教训
25. **沙箱策略中途切换**（danger-full-access → workspace-write → ask → never）：操作被打断需重试；策略变化后先确认当前模式再动手。
26. **目标机与 CI 环境编码差异**（PS 5.1 vs pwsh7）：本地成功 ≠ CI 成功，发布前必须跑真实 CI。
27. **发布依赖用户认证要提前暴露**：发布动作不可自动化时，明确列出选项（token/手动/交互）让用户选择，不要卡住。

---

## 五、数据成果（真实机器实测）

| 指标 | 数值 |
|---|---|
| MFT 扫描提速 | 5.5s vs 43.1s（~8x） |
| 全盘重复 | 1503 组 / 可释放 17.3GB（微信备份、安装包、torch DLL） |
| 配额 | administrator 1.1TB（AppData 875GB / Desktop 77.8GB） |
| 健康 | 双 SSD 识别，57°C 正确触发"注意" |
| EXE | 82.1MB，零依赖，SEA 单文件 |
| CI | 48s 全绿（语法/冒烟/打包/校验） |

---

## 六、一句话总结

**"把工具做成能交给陌生人的东西，考验的不是功能，而是编码一致性、安全默认和可复现的构建。"** 最大的三类坑是：Windows 编码（GBK/UTF-8/BOM/pwsh7）、NTFS 元数据解析（碎片/稀疏/异常字段）、发布链路（认证/CI 可移植性）——前两类靠"铁律 + 对比验证"解决，最后一类靠"本地闭环 + 真实 CI 验证"解决。

---

## 七、GUI 桌面端复盘（v0.3.0，2026-08-16）

> 第三形态：WebView2 原生窗口（C# 壳 + 引擎 serve 层 + 零依赖前端 + Inno Setup 安装器）。
> 完整 SOP 见 `docs/RELEASE-PLAYBOOK.md §3.5`；本节约不复述流程，只记**经验/教训/防复发**。

### 7.1 决策与架构（好的点）

| # | 决策 | 为什么好 |
|---|---|---|
| G1 | 壳零业务逻辑（C# 只做提权+拉起+托管 WebView2） | 8 工具全部走 `lib/serve.js` HTTP 层，引擎只写一处，GUI 永远同源 |
| G2 | `TcpListener(IPAddress.Loopback, 0)` 找空闲端口 + Guid token | 无端口冲突、无外部暴露；仅绑 127.0.0.1 + Bearer 鉴权 |
| G3 | 扫描子进程 `--internal-scan` + `--progress` 文件轮询 | 复用 CLI 既有机制，长任务不阻塞服务线程 |
| G4 | 前端零依赖（手写 HTML/CSS/JS）| 无 npm 构建、无 node_modules；引擎 SEA 免打包前端；体积小 |
| G5 | 框架依赖 + 缺则引导官方 bootstrapper | 壳自包含会 +60MB；引导下载把运行时决策交给用户 |
| G6 | 破坏性操作后端默认 dryRun + 前端「预览→确认」双确认 | 安全默认贯穿三层 |
| G7 | clean 空路径自动提取候选（与 CLI 同逻辑）| GUI 一键清理 UX 好，且"宁拒勿删"（提取不到即 400） |
| G8 | 验证链：API 冒烟 → Edge headless 渲染 → 静默安装 → GitHub 下载校验 | 每一层都有可复现验收，发布前已经模拟过真实用户路径 |

### 7.2 GUI 犯错清单（含修复，全部已闭环）

| # | 错误 | 根因 | 修复 |
|---|---|---|---|
| G9 | CS8632 编译错 | Nullable disable 下写了 `?` 注解 | 去掉 `?`，`GetArg` 返回 `string.Empty` |
| G10 | 引擎路径空 → FATAL engine missing | `??` 对空串无效 | `IsNullOrEmpty` 判断（空串 ≠ null） |
| G11 | 引擎打印 help 即退 | spawn 传了 `--serve`（flag）而非 `serve`（位置参数） | `Arguments = "serve --port ..."` |
| G12 | 编辑 Program.cs 漏 `}` → CS1513 | 手改大文件 | 编译前 `dotnet build` 快速失败（不攒到最后 publish） |
| G13 | MSB3277 WindowsBase 警告 | WebView2 包含 WPF/WinForms 双程序集 + UseWindowsForms | TFM 提到 `net8.0-windows10.0.17763.0` 后 CS8632 消失；MSB3277 无害接受 |
| G14 | 引擎 stdout 中文乱码 | PowerShell `Get-Content` 按 GBK 读 UTF-8 日志 | 读取加 `-Encoding UTF8`；C# 加 `StandardOutputEncoding=UTF8` |
| G15 | 旧 SEA 引擎无 serve | 改 serve.js 后没重建 dist exe 就复制 | 重打包链固化进 build-installer.ps1（先引擎后壳） |
| G16 | pwsh 未传 workdir 落错目录 | 工具默认 cwd 非仓库 | Copy-Item 等一律用绝对路径参数 |
| G17 | PS 5.1 `New-Object ProcessStartInfo` 无 ArgumentList | pwsh7 特性 | 用 `Arguments` 字符串，路径加 `\"` |
| G18 | 发布断言误读 | dotnet publish 实际成功（PDB/XML 已出）| 以产物文件存在为准，不轻信中间断言 |
| G19 | clean 空路径 400 | validate 对非 recycle-bin 要求 paths 非空 | serve 层 `extractCleanPaths` 从报告自动提取 |
| G20 | .NET 检测误判（提示未装，实际已装 8.0.30） | 注册表布局因安装器而异 | 文件夹探测 `DirExists + FindFirst('8.0.*')` |
| G21 | DownloadTemporaryFile 编译错 | 误以为 3 参 Boolean | 实签 4 参 `(Url, BaseName, RequiredSHA256OfFile, OnDownloadProgress): Int64`（失败 -1） |
| G22 | 下载路径前缀重复（`{tmp}\{tmp}\`）| BaseName 传了全路径 | BaseName 只传裸文件名（自动落 {tmp}） |
| G23 | PascalScript 编译错 | 函数定义在调用之后（无前向引用） | 先声明 DownloadAndRun 再 InitializeSetup |
| G24 | 中文向导语言缺失 | 官方安装包不带 ChineseSimplified.isl | 向导英文，程序 UI 双语不受影响 |
| G25 | Edge headless 空输出 | 旧 `--headless` 模式 | `--headless=new` + 独立 `--user-data-dir` |
| G26 | E2E 端口取错 | 复用了上一轮日志（未清）| 每次测试前 `Remove-Item $env:TEMP\disk-clean-ui.log` |
| G27 | gui/stage 被误提交 | 忘记加 .gitignore | `git rm --cached` + 补 `gui/stage/` |
| G28 | 引擎重建后 SHA256SUMS 仍是旧值 | dist 文件与校验集不同步 | 构建后重算；发布前本地 sha × 资产 digest 双向核对 |
| G29 | gh shell 输出无法 JSON 解析 | PS 5.1 把 stderr 混入 stdout（NativeCommandError 噪音）| 复杂 JSON 用 Invoke-RestMethod API 验证 |
| G30 | `gh release delete` 静默失败 | exit 0 但未删 | API `DELETE /releases/{id}` 兜底（204） |
| G31 | PS 5.1 三元运算符解析错 | `? :` 是 pwsh7 语法 | if/else |
| G32 | E2E 后遗留进程/目录 | 测试进程未收尾 | Start-Process 记录 PID → 结束 → 删测试目录 |
| G33 | `Copy-Item -Recurse -Force` 到已存在目录变成**嵌套复制** | Copy-Item 目录语义：目标已存在时并入子目录 | 文件级复制（`Copy-Item src\SKILL.md dst\SKILL.md -Force`）；或先删目标目录再复制 |

### 7.2 v0.3.1 修复迭代复盘（用户反馈回归 → 全量验证）

用户报告：「首页容量 24kb 对不上 / 默认全选 / 选中 D 却扫出 2.2TB（D 才 700GB）/ 无图标」。
修复思路：不猜 → 读 `~/.disk-clean/report.json` 实锤 → 修 serve 层 → 前端改交互 → 图标管线 → 开发态真机四层回归。

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| G34 | 首页盘符容量显示 24kb | `listDrives` 用 `fs.statSync(root).blocks*512`，那是**根目录自身占用的块数**（几十块=24KB），与磁盘容量无关 | `fs.statfsSync` → `bsize*blocks/bfree/bavail` 真实卷容量；实测 D=704GB/可用 133GB 与用户一致 |
| G35 | "选中 D 却扫出 2.2TB（D 才 700GB）" | **默认全选 + 点击=切换**：点 D 反而取消 D，实际扫了 C+E+F。report.json 实锤 roots=[C:,E:,F:]，totalBytes=2.27TB（三盘合计），并非 D 超容量 | 首次默认只选 D + localStorage 记忆上次选择 + 全选/清空按钮 + **扫描前确认弹窗**（列出盘+已用/合计）+ 报告显示扫描范围；D 全量重扫 totalBytes=587.26GB ✅ |
| G36 | 去重"硬链接合并"空 roots | 前端传 `roots:[]` → 服务端回退扫 `C:\；D:\` 全盘，与预览范围不一致 | 缺省改回退最近报告 `summary.roots`；无报告则 400 要求显式传入；前端复用 lastScanRoots 并在确认弹窗显示范围 |
| G37 | MFT 页盘符硬编码 `['C:','D:','E:','F:']` | 写死列表 | 从 `/api/drives` 动态生成 |
| G38 | 计划任务"每周"必失败 | weekly 需 `day`，前端无输入 → 服务端 400 | 加 MON..SUN 下拉（切 weekly 显示） |
| G39 | 图标脚本构造失败 | PS 5.1 `New-Object Type(` 参数列表**跨多行解析失败返回 null**；BOM-less UTF-8 中文注释被按 ANSI 错读 | 全 ASCII 注释 + 全部 `::new()` 单行构造；沉淀 `scripts/make-icon.ps1`（SVG 概念→System.Drawing→多尺寸 PNG→PNG-in-ICO） |
| G40 | organize apply 400（测试期假警报） | PS 5.1 `Invoke-WebRequest -Body 字符串` 默认 Latin-1 编码，中文路径变 `???` | 测试用 `[Text.Encoding]::UTF8.GetBytes($json)` 字节体；产品（fetch UTF-8）无此问题 |
| G41 | 主页卡片视觉选中态与实际不一致 | `loadDrives` 重建卡片未按 `selectedDrives` 恢复样式（刷新后看到"没选中"但数组有值） | `syncDriveCards()` 统一同步样式+计数 |
| G42 | 扫描无取消入口 | serve 层无中断 API | `POST /api/scan/cancel`（SIGTERM→engine cancelled）+ 前端取消按钮；**取消测试必须用临时 report 路径**，否则覆盖好报告 |
| G43 | 数据正确性验证缺方法 | — | 三重断言：`roots==所选`；`totalBytes ≤ 卷容量`；`categorySum==totalBytes`（D 全量 0 差）。D：138.2 万文件 / 19.7 万目录 / 587.26GB ✅ |

好点（继续沿用）：
- **用报告文件实证**定位"2.2TB"真相（不猜、不甩锅给容量算法）；`statfsSync` 实测与用户口述吻合。
- 开发态 `node bin/disk-clean.js serve` 直跑：API 矩阵（15+ 项）+ **真机 D 全量扫描** + headless DOM/console 校验四层组合，覆盖数据链路与渲染。
- 破坏性操作（clean/organize/dedup）全部走 dryRun 预览 + 双确认，回归只做预览，不动真数据。
- 取消/未知任务/已完成任务三态 API 契约全部验证（done 任务返回 note、未知 404）。

### 7.3 防复发要点（GUI 专项）

1. **服务层第一坑**：CLI 位置参数 vs flag —— spawn 前确认参数语义（`serve` 不是 `--serve`）。
2. **版本四源**：`bin/VER`、`lib/serve.js VER`、`DiskCleanUi.csproj Version`、`package.json version`
   ——发布前 grep 核对，`checksums.txt version=` 来源于 package.json。
3. **构建顺序**：改 serve.js → 必重建 SEA → 再组装安装器；上传期间不重建源文件。
4. **C#**：Nullable disable 无 `?`、GetArg 空串、ProcessStartInfo 用 Arguments、改后立即 build。
5. **Inno Setup**：函数先声明、DownloadTemporaryFile 4 参裸名、FindFirst 用 TFindRec、检测用文件夹。
6. **验证**：headless 必须 `--headless=new`；E2E 前清日志；发布判据 = GitHub 下载→sha→安装→启动→健康。
7. **盘符容量**：一律 `fs.statfsSync`（`bsize*blocks/bfree/bavail`）；绝不 `statSync(root).blocks`（那是目录自身块数）。
8. **范围型操作铁律**：扫描/去重/整理任何"作用域"都必须有范围确认与回显；服务端缺省范围只能取最近报告 `summary.roots`，**绝不静默回退全盘**。
9. **PS 5.1 脚本**：所有构造调用单行 + 脚本全 ASCII 注释（BOM-less UTF-8 中文会被 ANSI 错读）；PowerShell 调 API 发 JSON 必须 `UTF8.GetBytes` 字节体。
10. **图标管线**：`scripts/make-icon.ps1` 是构建链 step 0；三处接入 = csproj `ApplicationIcon` + iss `SetupIconFile` + web `favicon.svg`（serve 静态白名单已含 .ico/.svg）。
11. **`dist/SHA256SUMS.txt` 是发布时组装的**：build-sea 只写 `dist/checksums.txt` 与 `exe.sha256`；release 前用新引擎 sha + setup sha/size 重算并双向核对。
