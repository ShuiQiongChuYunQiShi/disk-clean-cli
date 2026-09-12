# disk-clean v0.7.0 — 质量周

**发布日期**：2026-09-11 · **上一版本**：v0.6.0 · **主题**：兑现承诺、统一口径、补齐缺口、按实测优化

> 本版本**没有新功能**。它清除的是三类"工具在骗你"的问题：承诺了却不生效的配置、
> 同一动作在不同入口行为不同、以及被夸大的性能数字。所有性能结论都附**实测**数据。

---

## ⚠️ 一处行为变更（唯一可能影响你现有习惯的）

**`dedup rollback` 现在需要 `--yes`。**

此前 `disk-clean dedup rollback` 会**无条件执行**，而 `organize rollback` 与 MCP 的
`disk_dedup cmd=rollback` 都要求确认——同一个动作三种确认模型。现在统一：不加 `--yes`
只输出预览（列出将还原的文件数与预计重新占用的空间），加 `--yes` 才执行。

```powershell
disk-clean dedup rollback          # 预览：将把 N 个硬链接还原为独立副本
disk-clean dedup rollback --yes    # 执行
```

---

## 一、清除"假承诺"（本次最高优先级）

### `config.blacklist` 已删除

`blacklist` 从未被任何引擎代码读取——它只在配置默认值里定义，却在 **MCP 工具描述**里被
描述为"强制清理候选"。也就是说：**AI 会去设置它，并期待生效**。

本仓库的原则是"要么实现，要么从描述里删掉"，因此选择**删除**：从 `DEFAULT_CONFIG`、
MCP 工具描述、README 命令表移除，`ROADMAP.md` 标注为"已移除（从未实现）"。
`lib/config.js` 里保留一条注释说明缘由，防止后人以为漏删又加回去。

> 附带修正：`disk_config` 的工具描述现在明确写出"**配置只能收窄而不能放宽安全边界**——
> 系统目录与 OneDrive 始终由 `lib/guard.js` 拒绝，不受配置影响"。

### `retention.auditLines` 现在真正生效

此前该配置项（默认 5000）**永不生效**：`lib/audit.js` 把上限硬编码为 2000，写了没人读。
现在 `audit.js` 惰性读取配置，**改完立即生效，无需重启**；读到非法值（如 0）回落到 2000，
不会出现"上限为 0 → 轮转把日志清空"。

---

## 二、同一动作，统一口径

- **`dedup rollback` 要求 `--yes`**（详见开头的行为变更）。
- **CLI `clean` 补上 `stale-large`**：MCP 的 `disk_clean` 一直支持这个类型，CLI 却没有。
  现在 `disk-clean clean stale-large` 能从报告提取陈旧大文件候选。
- **`clean` 的 dry-run 现在会列出将要处理的路径**。对一个破坏性操作来说，
  只说"将清理 5 个路径"却不说是哪些，用户无从判断——MCP 侧一直返回路径清单，CLI 此前没有。

---

## 三、补齐缺口

### 新增 `disk-clean drives`

CLI 此前没有这个命令，而文档多处提到盘符信息。现在：

```
▶ 本地盘容量（来自卷文件系统统计，与资源管理器一致）

  盘符  已用 / 总计                   可用        使用率
  C:    373 GB / 499 GB              126 GB  ███████████████░░░░░  74.8%
  D:    600 GB / 704 GB              104 GB  █████████████████░░░  85.2%
  E:    495 GB / 703 GB              209 GB  ██████████████░░░░░░  70.3%
  F:    1.5 TB / 1.9 TB              342 GB  ████████████████░░░░  82.1%
```

**并且在实现它之前先做了单源化**：查代码发现"列盘容量"这件事**已有两份实现**
（`lib/mcp/tools.js` 与 `lib/serve.js` 各算一遍 `statfsSync`）。若再加第三份，就是重犯
v0.6.0 刚修掉的 A3（同一名单被抄成 5 份）。因此抽出 `lib/drives.js` 作为**唯一事实源**，
三处统一调用。

> 兼容性说明：`lib/drives.js` 同时返回 `totalBytes/usedBytes/...` 与短名 `total/used/...`，
> 后者是 **GUI 前端盘符卡片既有依赖**。本次只统一**计算**，不改字段名以免打断前端渲染——
> 这层兼容是有意保留的，不是遗留物。

### CHANGELOG 补齐 0.2.0 / 0.3.0 / 0.3.1

这三个版本一直只有 tag 与 Release、没有 CHANGELOG 段落。本次补写，
**依据是 `git log <prev>..<tag>` 的真实提交、当年的 GitHub Release 正文，以及
`docs/RELEASE_NOTES-v0.2.0.md`** —— 无据可依的内容一律不写。

### `mcp/server.js` 的编码问题：已排查、未复现、故不改

评审怀疑"stdio 未显式 `setEncoding('utf8')` 会让 GBK 管道下的中文乱码"（标注为*推测*）。
实测（UTF-8 客户端，符合 MCP 规范）：`tools/list` 返回的中文描述无 U+FFFD 替换字符，
含中文的 `disk_config` 参数能原样往返。**结论写入代码注释**，说明这是客户端违反
MCP 的 UTF-8 约定所致，不应在服务端做二次解码——以免后人重复排查。

---

## 四、性能：做，但用实测口径

**原计划照搬了锐评的估算，本次实测发现那个估算夸大了约 15 倍**，因此先更正判断、再动手：

| 项 | 锐评说法 | 实测（改前） | 实测（改后） | 效果 |
|---|---|---|---|---|
| 硬链接合并的 PowerShell 调用 | 上千文件 ≈ **30–50 分钟** | **144 ms/个** → 1000 个 ≈ 2.4 分钟 | **0.66 ms/个** → 1000 个 ≈ **0.7 秒** | **218x** |
| `dedup` 的文件 `stat` | 全盘数十万文件时"成为纯瓶颈" | 1 万文件：stat 阶段 292ms | stat 阶段 **71ms**（4.1x） | 整体 772ms → **540ms**（1.43x） |

### 硬链接合并不再使用 PowerShell

原实现对**每个** victim 都 `spawnSync` 一次 PowerShell `New-Item -ItemType HardLink`。
实测发现 Node 内建的 `fs.linkSync` 直接可用（同 inode、`nlink=2`、共享数据验证通过），
耗时 **0 ms** vs PowerShell 的 141 ms —— 所以正解不是"批量调用 PowerShell"，
而是**根本不用它**。

保留 PowerShell 作为回退（两者最终都调用 Win32 `CreateHardLink`，语义一致），
以免在极少数环境/非 NTFS 卷上出现功能回归。任何一条路径失败时备份都会改回原位，**不会丢数据**。

> 60 文件基准：合并 59 个从 8470 ms 降到 **39 ms**；回滚 59 个 61 ms。

### `dedup` 的文件 `stat` 改为并发

文件遍历里的 `stat` 此前是**串行 await**，全盘量级下成为纯等待。现复用本文件既有的
`pool`（并发 16），与 head/tail 哈希阶段的并发模型一致。

1 万文件基准：整体 772 ms → 540 ms。外推 40 万文件约省 **9 秒**——真实但不大，
**所以本次没有把它当作头号任务**（详见 `docs/PLAN-v0.7.md` §1.0 的重排理由）。

---

## 五、跨盘移动失败不再"隐身"

跨盘移动是"先复制、再删源"。若复制成功而删除源失败，会**留下两份副本**——
而重试又被 `COPYFILE_EXCL` 卡成 `EEXIST`，用户最终只看到一条 `fail: EEXIST`，
既不知道副本已经在目标盘上，也不知道源还在。

现在这种状态会被识别并**明确上报**：

```
⚠ 2 项出现「已复制但源未删除」，两份副本并存：
    D:\Users\me\Downloads\big.iso
    E:\整理区\备份\big.iso
  本工具未自行删除任何一份（以免误删）。确认无误后请手动删除其一。
```

审计日志同步标记为 `partial`，MCP/GUI 侧也拿到独立的 `duplicated` 列表。

---

## 六、测试

新增 **`test/cli-and-config.js`**（套件 11 → **12**），7 组断言专守本版每一项：
`blacklist` 已删、`auditLines` 生效、`drives` 单源且命令可用、`clean stale-large` 可提取、
`dedup rollback` 无 `--yes` 时**不得真的回滚**（断言 `nlink` 仍为 2）、硬链接走
`fs.linkSync`、双份副本会被识别。

> 编写过程中该套件**当场抓到我自己的两处疏漏**：① 断言写得太宽，把注释里出现的
> `statfsSync`/`blacklist` 字样误判为"仍在调用/仍在使用"；② 反过来又发现 CLI 的
> dry-run 确实只报数量不报路径——那个断言原本会掩盖真实的 UX 缺陷。

```
node test/all.js   →   12/12 passed
```

---

## 七、升级建议

```powershell
npm install -g disk-clean@latest           # 或
.\disk-clean-win-x64.exe version           # 应显示 v0.7.0
```

**如果你用过 `config` 设置 `blacklist`**：该字段已移除。它此前**从未生效**，
所以删除不会改变任何已有行为；配置文件里若残留该键会被忽略（不会报错）。

**如果你写过 `dedup rollback` 的自动化脚本**：请加上 `--yes`（见开头的行为变更）。

## 已知问题 / 未完成

- 引擎模块级状态（`engine-core.js` 靠 `resetState` + 串行队列掩盖）、
  `gui/web/app.js`（1137 行）拆分、MFT 清理管线 —— **留待 v0.8，且需重新评估后才启动**
  （投入大、用户无感），见 `docs/PLAN-v0.7.md` §3。
- npm 上仍存在 `0.4.1`（含 v0.6.0 修复的 P0）；`latest` 已指向 0.7.0，正常安装不会再碰到。
- MFT 直读漏读约 1.9 万记录（约 98% 覆盖）。

## 校验

```
SHA256SUMS.txt / disk-clean-win-x64.exe.sha256 / disk-clean-setup-0.7.0.exe.sha256
```

发布前已核对：本地构建哈希 == Release 资产哈希（含**下载回本地复算**），CI 在对应 commit
上通过，`node test/all.js` **12/12** 全绿，`npx -y disk-clean mcp` 端到端返回 12 个工具。
