# Windows 磁盘清理与分析器 —— DeepSeek Harness 插件版

本目录是 [disk-clean-cli](../README.md) 的 **DSH（DeepSeek Harness）插件形态**：同一个引擎，
以 AI 对话方式驱动——自然语言指令 + 8 个模型侧工具 + 可确认、可回滚、可审计的安全操作。

- **形态**：静态插件（`agent.cordis.yml` 内直接引用 `plugins/disk-analyzer/host.static5.js`，
  会话挂载即加载，免 cordis_define / 免审批）+ 独立 Node 辅助进程引擎
- **平台**：Windows（Win10/11，Node ≥ 18，PowerShell 5.1+）
- **语言**：中文界面
- **与 CLI 的关系**：插件的高级功能（health / mftscan / dedup / quota）经 `plugins/dsk-lib/`
  调用，与仓库 `lib/` 同源；两侧功能持平。

---

## 一、功能

| 工具 | 说明 |
|---|---|
| `disk_scan` | 全盘/分区扫描：分类统计、大文件/大目录、8 类智能建议（含散落目录整理建议）、Markdown 报告 |
| `disk_clean` | 清理：回收站（永久删除，双确认）、临时/垃圾文件、空目录（移入回收站，可恢复） |
| `disk_organize` | 目录整理：plan 只读预览 → apply 移动（自动重写快捷方式）→ rollback 回滚 |
| `disk_audit` | 审计日志：每次执行的时间/类型/路径/字节/结果 |
| `disk_health` | SMART 健康检查：所有物理盘温度/SSD 寿命/通电小时/读写错误，健康分级 |
| `disk_mftscan` | MFT 直读快扫（约 8 倍速）：文件/目录/MFT 记录统计 |
| `disk_dedup` | 全盘重复文件检测 + 硬链接合并（可回滚，需审批） |
| `disk_quota` | 每用户配额分析（MFT 目录聚合） |

> 兼备可选交互式图表面板：动态插件版本（`plugins/disk-analyzer/host.js` + `client.js`）
> 通过 cordis 会话 `cordis_define` 安装，提供扫描进度、分类饼图、大目录条形图等可视化。

## 二、安装

前置：已安装 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）。

1. 将本 `plugin/` 目录**整体复制**为 agent preset：

```powershell
# PowerShell（按需替换用户名）
$dst = "$env:USERPROFILE\.dsh\.agent-presets\disk-analyzer"
Copy-Item -Recurse -Force .\plugin $dst
```

   复制后结构应与仓库一致，重点是：
   `agent.cordis.yml` 引用的 `./plugins/disk-analyzer/host.static5.js` 相对路径保持不变。

2. 在 DSH GUI 的预设选择器中启用「磁盘分析专家」，进入新会话。
3. 验证：让模型执行 `disk_scan cmd=drives`，应返回盘符与容量。

> 静态插件在**会话挂载时**注册工具；修改插件文件后需新开会话生效。
> 插件目录需可写：`.dsk-prog.json` / `.dsk-audit.json` / `.dsk-report.json` /
> `.dsk-organize-*.json` / `.dsk-health.json` / `.dsk-dedup-map.json` 等运行时文件写在该目录。

## 三、使用示例

```text
用户: 磁盘满了
助手: disk_scan drives → start(C:\) → status → report → 展示建议

用户: 清理临时文件
助手: disk_clean type=junk-temp paths=[建议路径] → DSH 审批 → 执行 → disk_audit

用户: 下载文件夹太乱了
助手: disk_organize plan（只读预览）→ 确认 → apply → （不满意）rollback

用户: 磁盘温度怎么样
助手: disk_health → 各物理盘温度 / SSD 寿命 / 健康分级

用户: 全盘有哪些重复文件
助手: disk_dedup scan → 重复组列表 → hardlink（审批后合并）→ 可 rollback 回滚
```

详见 `skills/disk-analyzer/SKILL.md`（安装/使用/安全/故障排查）。

## 四、安全模型

1. 默认只建议不执行；删除 = 预览 → 用户确认 → DSH 审批（双确认）。
2. 优先移入回收站（可恢复）；仅回收站清空为永久删除。
3. 白名单校验：清理路径必须来自最近一次报告的**建议明细**，宿主拒绝一切清单外路径。
4. 系统目录（Windows/Program Files/ProgramData/WinSxS/$RECYCLE.BIN）只统计不清理。
5. 每次执行写 `.dsk-audit.json` 审计日志（时间/类型/路径/字节/结果）。
6. 扫描引擎只读；删除由宿主生成 PowerShell 脚本（路径单引号转义 + UTF-16LE base64）。
7. dedup 硬链接合并同样需 DSH 审批，保留映射可回滚。

## 五、目录结构

```
plugin/
├── agent.cordis.yml                # 预设组成（cordis 基底 + 磁盘专家 persona + 静态插件行）
├── preset.yml                      # 预设元数据
├── plugins/
│   ├── dsk-helper.js               # 引擎（扫描/建议/清理执行入口）
│   ├── dsk-adv.js                  # 高级功能辅助进程（health/mftscan/dedup/quota 入口）
│   ├── dsk-lib/                    # 高级功能引擎（与仓库 lib/ 同源）
│   │   ├── mftscan.js              # MFT 直读快扫
│   │   ├── dedup.js                # 全盘重复检测 + 硬链接
│   │   ├── quota.js                # 每用户配额
│   │   └── ext-cat.js              # 扩展名分类表
│   └── disk-analyzer/
│       ├── host.static5.js         # 宿主半（静态插件，预设挂载即加载，DSK_DIR 自动推导）
│       ├── host.js                 # 宿主半（动态模板，`__DSK_DIR__` 占位，cordis_define 安装用）
│       ├── dsk-helper.js           # 引擎副本
│       ├── client.js               # 客户端半（可视化面板，动态插件版本）
│       └── dsk-client.js           # 客户端辅助
└── skills/
    ├── disk-analyzer/SKILL.md      # 使用手册（安装/使用/安全/故障排查）
    ├── editing-cordis-compositions/SKILL.md
    └── cordis-plugin-development/SKILL.md
```

> `host.static5.js` 的 DSK_DIR 自动推导为 preset 根目录（本文件上溯两级），
> 复制到任意预设 id 下无需改代码。