# disk-clean v0.6.0 — 安全加固版

**发布日期**：2026-09-11 · **上一版本**：v0.5.0 · **主题**：安全加固（不新增功能）

> 本版本源于一次针对 v0.5.0 的独立第三方锐评。锐评提出 1 个 P0 与若干安全/正确性缺陷，
> 经逐条复现确认后全部修复。**其中 P0 是真实存在的不可逆数据破坏**，建议所有 v0.5.x 用户升级。

---

## ⚠️ 最重要的修复：硬链接合并可能静默破坏文件内容

**影响版本**：v0.4.0 – v0.5.0（`dedup` 功能引入起，至本版修复）
**触发条件**：对 >32MB 的重复文件执行 `dedup --hardlink --yes`（或 MCP 的 `disk_dedup cmd=hardlink`、GUI 的去重合并）

### 问题

去重引擎对大于 32MB 的文件**只比对头部 64KB 与尾部 64KB**，相同即判定为重复并标记
`approx: true`（这是有意的性能取舍——全量哈希几万个 GB 级文件不现实）。
但 CLI、MCP、GUI **三条路径都没有检查这个标记**，直接把它们合并成了硬链接。

硬链接是"同一份数据的多个文件名"。一旦建立，两个文件就共享内容：**改一个，另一个跟着变**。
而备份文件 `.dsk-dup-bak` 在合并成功后被立即删除，**没有任何回滚余地**。

### 实测复现

用两个 33MB 文件（头尾 64KB 相同、中间不同 —— ISO / 视频 / 安装包的容器头形态，现实中极常见）：

```
合并前：两文件中段字节 = 17 / 34  → 内容不同
扫描判定：approx=true  组内文件数=2
hardlinkGroup 结果：["hardlink"]
合并后：两文件中段字节 = 17 / 17
>>> 已复现：内容不同的两个文件被合并成同一份数据（不可逆）
>>> 备份 .dsk-dup-bak 是否残留: false
```

第二个文件的内容**永久消失**。而且它不会报错、不会提示——用户直到某天打开那个文件
才会发现内容变成了别的东西。

### 修复

在唯一收口 `hardlinkGroup()` 内**硬性拒绝** `approx` 组（fail-closed）。
三个调用方（CLI / MCP / GUI）都经过这个函数，因此无需各自过滤，也不存在"漏掉某条路径"的可能。

- 预览态与执行态**行为一致**：预览时就说"拒绝"，不会出现"预览说将合并、执行时说不行"。
- CLI 会列出被拒绝的项数与原因（默认显示前 5 条明细）。
- MCP 会把 approx 组**显式分流**，并告诉模型改用 `disk_clean type=duplicates`
  （移入回收站，**可恢复**）——而不是让模型以为"操作失败"后反复重试同一调用。
- `approx: false` 的精确组（≤32MB 已全量哈希确认，或大小不同）**照常可以合并**，功能未被削弱。

---

## 其他安全修复

| # | 问题 | 影响 | 修复 |
|---|---|---|---|
| **A2** | `hardlinkGroup()` 全程不过安全闸门 | 路径若落在系统目录，系统文件会被改成指向别处的硬链接 | 每个 keep/victim 逐一过 `guard.checkDestructivePath` |
| **A2** | 扫描根自身不校验（`walk(root, [])` 传空段） | `roots=['C:\Windows\System32\drivers']` 会放行并开始哈希系统文件 | 根自身先过 `guard.isProtectedPath`，命中记入 `skippedRoots`（不静默跳过） |
| **A3** | 保护名单实际有 **5 份**副本，各只有 **7 段**（`guard.js` 是 16 段） | 副本缺 `windows.old`/`boot`/`efi`/`recovery`/`perflogs`/`msocache`/`config.msi`/`$windows.~bt`/`$windows.~ws` 共 9 段；同一个 `C:\Users\me\windows` **清理侧拒绝、整理侧放行** | 四处副本全部改为 `require('./guard.js')`，源码内只剩一处定义 |
| **A4** | 整理目标只做前缀正则 | `C:\整理区\..\boot\x` 通过检查，OS 解析为 `C:\boot\x` —— 管理员会话下真的会移进受保护目录 | 新增 `guard.checkOrganizeDest()`：归一化 + 拒绝 `.`/`..` 段 + 断言位于 `<盘>:\整理区\<分类>` |
| **A5** | `organize` 自写前缀匹配 `lp.indexOf(root) === 0` | `C:\UsersOther` 会命中扫描根 `C:\Users` | 统一走 `guard.inRoots`（含分隔符边界） |

### 关于 A3 的特别说明

v0.5.0 的 README 曾宣称"One safety gate, one source（安全闸门单源）"。**这个声明当时是假的**：
`engine-core.js`（`DANGER`）、`organize.js`（`SYS_PREFIX`）、`bin/disk-clean.js`（正则）、
`serve.js`（`SYS_RE`）各自还留着一份 7 段副本。

其中 `organize.js` 的副本还缺少 `guard.js` 特有的**尾部匹配**，导致同一路径在不同入口
得出相反结论。现在这条声明可以用一条命令证伪，发布前会跑：

```powershell
grep -rn "program files" --include="*.js" lib bin gui | grep -v guard.js   # 应零命中
```

---

## 正确性与可用性修复

- **`dedup-map.json` 统一 schema（A6）**：MCP 写 `{entries:[…]}`，CLI 与 GUI 写 `{merged:[…]}`，
  读取端各读各的 —— 结果是**"AI 合并的文件，GUI/CLI 回滚不了"**（读到空的 `merged`，
  报"没有可回滚记录"）。现读写只在 `lib/dedup.js` 一处，一律写 `entries`、兼容读旧 `merged`；
  回滚改为 append-only，失败项保留记录供重试。
- **回收站匹配统一 `canonKey`（A7）**：`tools.js` 早已用它修掉 8.3 短名（`ADMINI~1` vs `Administrator`）
  失配，而 `serve.js` 仍用裸 `toLowerCase()`——GUI 的"回收站恢复"**列不出自己刚清理的项**。
  现 `canonKey` 上移到 `lib/guard.js` 单源。
- **部分成功不再伪装成成功（B4）**：清理时被占用/权限不足的项会被静默跳过，`3/5` 也返回
  `ok:true`，AI 只读 `ok` 就会宣布"清理完成"。现返回 `partial:true` 并写明"其余 N 项失败，
  未全部完成"；MCP 层对该情形上报 `isError:true`。
- **回滚映射改为原子写（B3）**：写入中途被杀会留下半截 JSON，读取端把解析失败 catch 成"空数组"，
  于是**回滚记录静默消失、已移动的文件再也回不来**。现为临时文件 + 同目录 rename。
- **畸形 URL 不再打崩服务层（B6）**：`/%`、`%zz` 会让 `decodeURIComponent` 抛 `URIError` 且无人捕获；
  现捕获后返回 400。

## 发布链路修复

- **`checksums.txt` 不再与产物脱节（G53）**：CI 在 tag 推送时用**它自己的** SEA 产物创建 Release
  并上传校验和，而发布脚本随后把 exe 覆盖成本地构建 —— 旧的 `checksums.txt` 就这么留在了 Release 上。
  v0.5.0 实际发生过：资产写着 `sha256=72ce9f21…`，而 exe 是 `3cbdc188…`。
  现发布脚本重算该文件、纳入上传清单，并**下载回来断言哈希**（只比体积抓不到——文件小，
  过期副本体积相同）。v0.5.0 的线上资产也已同步修正。
- **PS 5.1 响应体断言误报（G54）**：`Invoke-WebRequest -UseBasicParsing` 的 `.Content`
  在 PowerShell 5.1 返回 `Byte[]` 而非 String，与 `-match` 比较恒为失败 —— 资产完全正确却报不匹配。
  已显式按 UTF-8 解码，并在 PS 5.1 宿主上复验。

---

## 测试

新增 **`test/safety-gates.js`**（套件 10 → **11**），**23 组断言**专守上述每一项。
其中 A1 用**真实 >32MB 文件对**做端到端可达性证明：先断言扫描确实把它判为 `approx`
（证明缺陷路径可达），再断言合并被拒绝且两文件内容未变 —— 而不是只喂合成对象走个形式。

> 附带说明：该套件在编写过程中**当场抓到了修复自身的一次过度收紧** ——
> 我最初用遍历用的 `isSkip` 判断扫描根，而它包含 `appdata` 段，
> 导致 `%TEMP%` 下的合法扫描根被整个跳过。这恰好印证了新增第 4 条铁律：
> **测试没覆盖的边界等于没有边界**（A1 自 v0.4.0 起就在仓库里，10 个套件却全绿，
> 因为没有任何用例碰过硬链接的安全边界）。

```
node test/all.js   →   11/11 passed
```

## 文档

- 修正全仓库过期的测试套件数（9 → 10 → 11）。
- 修正 CHANGELOG 三个版本日期（与 tag / Release 实际日期对账）：
  0.5.0 `08-17` → `09-11`、0.4.1 → `08-25`、0.4.0 → `08-21`。
- `OPTIMIZATION-PLAN.md` 标注为**历史归档**，并点明其中涉及已删除 `plugin/` 形态的任务全部作废。
- `PROCESS-REVIEW.md` 修复重复的 `### 7.2` 标题，补齐两套编号（1–27 与 G1–G54）的图例。
- `GUI-PLAN.md`、`ROADMAP.md` 状态头与真实发布情况对齐。
- `RELEASE-PLAYBOOK.md` 新增 4 条铁律（§4 第 32–35 条）+ 1 条宿主差异（§6 第 31 条）。

---

## 升级建议

**所有 v0.5.x 用户都应升级** —— 本版修复的是可造成不可逆内容损坏的入口。

```powershell
# 单文件 EXE（免 Node）
.\disk-clean-win-x64.exe version      # 应显示 v0.6.0

# npm（注意：npm 首次发布仍待执行，见下）
npm install -g disk-clean

# GUI 安装器：运行 disk-clean-setup-0.6.0.exe
```

**若你曾在 v0.4.0–v0.5.0 期间对 >32MB 的重复文件执行过硬链接合并**，建议核查那些文件：
被合并的路径会共享同一份数据（删除任一路径不会释放空间，修改其一会影响全部）。
可用 `fsutil hardlink list <路径>` 查看某文件的硬链接列表。

## 已知问题 / 未完成

- **npm 渠道已同步**：npm 曾自 2026-08-25 起停留在 **0.4.1**（含本版修复的 P0 且无 MCP server）。
  **v0.6.0 已于 2026-09-11 发布到 npm**，`dist-tags.latest = 0.6.0`，包内同时含
  `disk-clean` 与 `disk-clean-mcp` 两个 bin；`npx -y disk-clean --version` → `v0.6.0`，
  `npx -y disk-clean mcp` 已端到端验证返回 12 个工具。
  **0.4.1 之前的安装应升级**：`npm install -g disk-clean@latest`。
- `CHANGELOG.md` 缺少 **0.2.0 / 0.3.0 / 0.3.1** 三个版本条目（有 tag 与 Release，无段落记录）。
- 锐评计划的**后续批次尚未实施**，已整理为 `docs/PLAN-v0.7.md`（含优先级与验收标准）：
  - **B1/B2 性能**：`dedup` 的文件 `stat` 串行、每个 victim 单独 spawn 一次 PowerShell
    （上千重复文件约需 30–50 分钟）。
  - **B5**：跨盘 copy 成功但 rm 失败时，会留下不可见的双份副本。
  - **B7/B8**：`config.js` 的 `blacklist` 是死配置（却在 MCP 工具描述里被承诺）；
    `retention.auditLines` 不生效（audit 硬编码 2000）。
  - **B9/B10**：`dedup rollback` / `organize rollback` 不要求 `--yes`（MCP 端却要 `confirm:true`）；
    CLI 的 `clean` 不支持 `stale-large` 自动提取。
  - **B11 / 架构季**：`engine-core.js` 的模块级状态靠 resetState + 串行队列掩盖；
    引擎实例化、MFT 清理管线、`app.js`（1137 行）拆分留待 v0.8 并需重新评估。
- MFT 直读漏读约 1.9 万记录（约 98% 覆盖），部分系统文件 `allocated` 字段异常（已有规则兜底）。

## 校验

```
SHA256SUMS.txt / disk-clean-win-x64.exe.sha256 / disk-clean-setup-0.6.0.exe.sha256
```

发布前已核对：本地构建哈希 == Release 资产哈希（含**下载回本地复算**），
CI 在对应 commit 上通过，`node test/all.js` 11/11 全绿。
