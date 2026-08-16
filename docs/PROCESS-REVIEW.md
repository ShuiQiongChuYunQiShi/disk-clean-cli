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
