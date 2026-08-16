# disk-clean

**Windows 磁盘清理与分析 CLI** —— 扫描、分类、智能建议、安全整理（自动修复快捷方式）与清理你的磁盘。零运行时依赖，可离线使用。

> ⚠️ 安全第一：所有破坏性命令**默认 dry-run（试运行）**。除非传入 `--yes`，否则不会移动或删除任何内容。移动操作均有日志且可回滚。

---

## 为什么选 disk-clean？

| 功能 | disk-clean | WizTree | CCleaner | 360/火绒 |
|---|---|---|---|---|
| 基于 raw NTFS MFT 的快速扫描（管理员） | ✅ **约 8 倍速** | ✅ | ❌ | ✅ |
| 移动目录到 `整理区` 且**可回滚** | ✅ | ❌ | ❌ | ❌ |
| 移动程序目录后**重写桌面/开始菜单快捷方式** | ✅（独有） | ❌ | ❌ | ❌ |
| 重复文件检测（用户区，基于哈希） | ✅ | ❌ | ✅ | ✅ |
| **全盘去重 + 硬链接合并** | ✅ | ❌ | ❌ | ❌ |
| **按用户配额分析** | ✅ | ✅ | ❌ | ❌ |
| **SMART / SSD 健康检查** | ✅ | ✅ | ❌ | ❌ |
| 每项操作的审计日志（JSONL） | ✅ | ❌ | ❌ | ❌ |
| 可读的 **Markdown 报告（中/英）** | ✅ | ❌ | ❌ | ❌ |
| 回收站安全（非直接永久删除） | ✅ | ❌ | ✅ | ✅ |
| 开源、无遥测、无广告 | ✅ | ✅ | ❌ | ❌ |
| AI 集成（可选，经 DSH） | ✅（插件） | ❌ | ❌ | ❌ |

---

## 安装

### 方式 A —— 单个 EXE（推荐）

从 [Releases](https://github.com/ShuiQiongChuYunQiShi/disk-clean-cli/releases) 下载 `disk-clean-win-x64.exe` —— 无需安装 Node.js。

```powershell
.\disk-clean-win-x64.exe scan D:\
```

### 方式 B —— 通过 Node.js（>= 14.16）

```powershell
npm install -g disk-clean    # 或：git clone + npm link
disk-clean scan D:\
```

### 方式 C —— DeepSeek Harness 插件（AI 驱动）

同一引擎也以 DSH agent preset（`disk-analyzer`）形式提供，支持自然语言控制与实时图表面板。见 [plugin/README.md](plugin/README.md)。

---

## 快速上手

```powershell
# 1. 扫描磁盘（报告：JSON + Markdown）
disk-clean scan C:\ D:\

# 2. 查看报告（终端摘要 + Markdown 渲染）
disk-clean report

# 3. 生成整理计划（散落目录 → <盘符>:\整理区\<分类>\）
disk-clean organize plan

# ……也包含程序/游戏目录（⚠ 移动后会重写快捷方式）
disk-clean organize plan --include-program

# 4. 先预览，再真正移动（默认 dry-run；加 --yes 执行）
disk-clean organize apply
disk-clean organize apply --yes

# 5. 撤销上一批（移动 + 快捷方式一并还原）
disk-clean organize rollback --yes

# 6. 清理垃圾（临时文件 / 空目录 / 重复文件 / 回收站）
disk-clean clean empty-dirs              # 预览
disk-clean clean empty-dirs --yes        # 执行（移入回收站）

# 7. 手动修复失效快捷方式
disk-clean fix-shortcuts pairs.json

# 8. 查看审计日志
disk-clean audit

# 9. MFT 快速扫描（需管理员，比目录遍历约快 8 倍）
disk-clean mftscan D:

# 10. 全盘重复文件检测（排除系统/程序目录）
disk-clean dedup D:\

# 11. 将重复文件合并为硬链接以释放空间（可回滚）
disk-clean dedup D:\ --hardlink --yes
disk-clean dedup rollback

# 12. 按用户配额分析（需管理员）
disk-clean quota C:

# 13. SMART / SSD 健康检查
disk-clean health

# 14. 破坏性操作前创建系统还原点
disk-clean organize apply --yes --restore-point

# 15. 英文报告
disk-clean scan D:\ --lang en
```

---

## 命令

| 命令 | 说明 |
|---|---|
| `scan [roots...]` | 全盘扫描并给出智能建议（散落目录、重复文件、长期未用大文件、垃圾、空目录）。生成 `report.json` + `report.md`。 |
| `report [file]` | 渲染已保存的报告（终端 + Markdown）。 |
| `organize plan` | 生成整理计划：散落目录 → `<盘符>:\整理区\<分类>\`。`--include-program` 额外加入程序/游戏目录并提示快捷方式修复风险。 |
| `organize apply [file]` | 执行计划。**默认 dry-run，除非加 `--yes`。** 程序目录必须带 `fixShortcuts`；快捷方式会被重写，回滚时还原。 |
| `organize rollback` | 撤销上一批（移动 + 快捷方式）。**默认 dry-run，除非加 `--yes`。** |
| `clean <type> [paths...]` | `junk-temp` \| `empty-dirs` \| `duplicates` \| `recycle-bin`。**默认 dry-run，除非加 `--yes`。** 项目移入回收站（可恢复）；仅回收站清空为永久删除。 |
| `fix-shortcuts <pairs.json>` | 重写指向已移动路径的 `.lnk` 文件（桌面 / 开始菜单 / 任务栏）。 |
| `audit` | 显示 JSONL 审计日志。 |
| `config` | 规则配置：白名单/黑名单、阈值、保留策略。 |
| `schedule` | 通过 Windows 任务计划程序进行定时扫描。 |
| `mftscan <drive>` | **实验性：** raw NTFS MFT 扫描（需管理员）—— 比目录遍历约快 8 倍；解析分片 $MFT runlist、重建完整路径，按 alloc/real 规则计算大小。 |
| `dedup [roots...]` | 全盘重复文件检测（排除系统/程序目录；头部/尾部 + 全量哈希策略）。`--hardlink --yes` 将重复文件合并为硬链接；`dedup rollback` 还原。 |
| `quota [drive]` | 通过 MFT 做按用户配额分析（需管理员）：用户排名 + 每人 Downloads/Documents/Desktop/… 明细。 |
| `health` | SMART / SSD 健康：温度、磨损百分比、通电小时、读写错误并给出健康等级。 |
| `--restore-point` | 加在 `clean` / `organize apply` 前，先创建系统还原点（系统保护关闭时优雅失败）。 |
| `--lang en\|zh` | `scan` 的报告语言（自动检测，默认跟随系统语言）。 |

---

## 安全模型

- **默认 dry-run** —— 每个破坏性命令先打印它将*会*做什么；加 `--yes` 才真正执行。
- **回收站** —— 垃圾/空目录/重复文件先移入回收站，而非直接永久删除。
- **回滚** —— 目录移动追加进 `organize-map.json`；`organize rollback` 还原上一批（含快捷方式）。
- **受保护路径** —— `\windows\`、`\program files*\`、`\programdata\`、`\winsxs\`、`\system volume information\`、`\$recycle.bin\` 永远拒绝操作。
- **审计日志** —— 每项操作追加到 `~/.disk-clean/audit.jsonl`（时间 / 类型 / 路径 / 结果）。
- **退出码** —— 0 正常 · 1 用户取消/参数错误 · 2 运行错误 · 3 扫描被取消。

状态文件位于 `~/.disk-clean/`：
```
audit.jsonl            # 审计日志
report.json / .md      # 最新报告
organize-map.json      # 回滚映射
organize-plan.json     # 最近一次计划
```

---

## 示例输出

```
▶ 正在扫描: D:\
✔ 扫描完成  (43.1s)
  总大小   : 630.2 GB   文件: 1381931   目录: 196460
  报告     : C:\Users\Administrator\.disk-clean\report.json
  Markdown : C:\Users\Administrator\.disk-clean\report.md

── 智能建议 ──
  [organize-folders] 目录整理建议 — 13 项 (164.0 GB)
  [stale-large] 清理长期未使用的大文件 — 14 项 (15.4 GB)
  [duplicates] 重复文件 — 46 组 (可释放约 110 MB)
  [recycle-bin] 清空回收站 — 67 MB
  [empty-dirs] 删除空文件夹 — 4490 项

▶ MFT 直读扫描: D:
✔ 扫描完成  (5.5s)   ← 比目录遍历约快 8 倍
  D:  总大小: 532 GB  文件: 1362274  目录: 196450

▶ 全盘重复检测: D:\
✔ 扫描完成  (35.1s)  重复组: 1503  可释放: 17.3 GB

▶ 配额分析: C:
  administrator   1.1 TB  (74.9%)
      ├ Desktop  77.8 GB
      ├ AppData  875 GB
```

完整 Markdown 报告样例见 [docs/demo-report.md](docs/demo-report.md)。

---

## 开发

```powershell
npm run check     # 所有模块语法检查
npm run smoke     # 引擎冒烟测试
powershell -File scripts\build.ps1   # 构建 exe + sha256
```

- 引擎：`lib/engine.js` —— 零依赖 Node（原生 `fs`），仅快捷方式修复使用 PowerShell COM。
- CLI 是薄壳；引擎同样以内嵌形式存在于 DSH 插件形态中。

## 可复用流程

见 [docs/RELEASE-PLAYBOOK.md](docs/RELEASE-PLAYBOOK.md) —— 构建 DSH 插件 + CLI、发布到 GitHub 并产出 Release 资产的逐步 SOP（可用于新项目复用）。历史回顾与错误目录：[docs/PROCESS-REVIEW.md](docs/PROCESS-REVIEW.md)。

## Roadmap

见 [ROADMAP.md](ROADMAP.md) —— 12 个阶段：配置规则、定时扫描、MFT 快速扫描、SMART 健康、全盘去重、按用户配额、系统还原点、i18n。

## 许可证

[MIT](LICENSE)