# Changelog

## [0.2.0] - 2026-08-16

### Added
- **MFT 直读快速扫描**（`mftscan <drive>`，需管理员）：解析碎片化 $MFT runlist、路径重建、alloc/real 合理性 size 规则；实测 ~8x 提速（D 盘 5.5s vs 43.1s），文件数/目录数与常规遍历一致（99%/100%）。
- **全盘去重**（`dedup [roots...]`）：head/tail 两阶段哈希 + 小文件全哈希确认；`--hardlink --yes` 转硬链接省空间，`dedup rollback` 还原。D 盘实测 1503 组、可释放 17.3 GB。
- **每用户配额分析**（`quota [drive]`，需管理员）：基于 MFT 目录聚合，用户排行 + Downloads/Documents/Desktop/AppData 等子目录明细。
- **SMART/SSD 健康检查**（`health`）：温度 / 寿命 Wear / 通电小时 / 读写错误 + 健康分级（健康/注意/警告/危险）。
- **定时扫描**（`schedule add|run|list|remove`）：Windows 任务计划注册 + 报告归档到 `~/.disk-clean/reports/`。
- **系统还原点**（`--restore-point`）：破坏性操作前可选创建，失败降级不中断。
- **i18n 报告**（`--lang en|zh`）：Markdown 报告双语模板，自动检测系统语言。
- **规则配置**（`config`）：阈值 / exclude 白名单 / 保留策略。

### Fixed
- schtasks 中文输出 GBK 解码；cmd /c 引号包裹；任务入口路径。
- MFT 记录解析：FILE_NAME 偏移、runlist 符号扩展 32 位溢出、稀疏文件 size 超卷兜底。

## [Unreleased]

### Added
- v0.1.0 首个可运行版本：独立 CLI（scan / report / organize / clean / fix-shortcuts / audit）
  - 全盘扫描 + 智能建议（散落目录/重复文件/垃圾/陈旧大文件/空目录）
  - 目录整理：移动可回滚，程序目录自动重写快捷方式（fixShortcuts）
  - 垃圾清理：移入回收站（可恢复），默认 dry-run + `--yes` 确认
  - 审计日志 JSONL
  - 报告输出 JSON + Markdown 双格式

## [0.1.0] - 2026-08-16
（首个发布版）
