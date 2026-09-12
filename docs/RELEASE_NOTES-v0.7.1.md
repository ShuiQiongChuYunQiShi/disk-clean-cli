# disk-clean v0.7.1 发布说明

> 主题：**可信数据**。这一版不加新功能，只解决"工具给出的信息能不能信"和
> "跑测试会不会动到你的数据"这两件事，并把研发/发布流程里该硬的地方做成脚本级门禁。

---

## 一、如果你跑过 `npm test`，请先看这一条（P0 修复）

**此前的测试会读写你真实的 `~/.disk-clean/`。** 15 个测试套件里有 12 个没有隔离状态目录，
后果不是"测试不够干净"，而是三条实际发生的事故：

1. 你的**扫描报告被覆盖**成测试临时树的扫描结果（一份几百 GB 的真实报告，被换成 1 MB 的测试树）；
2. **审计日志被污染**——审计是用来回答"这个工具到底动过什么"的证据，实测其中多数记录来自测试；
3. 测试文件被**真的丢进你的回收站**（实测一次 `totalInBin=15`）。

v0.7.1 起全部隔离到临时目录，并加了两层守卫防止复发：

- **静态**：每个套件都必须声明隔离，新增套件漏了就整体失败；
- **运行时**：跑测试前后对真实状态目录做**内容哈希**比对，新增 / 修改 / 删除任何文件都会被抓到。

> 已经造成的损失**无法自动恢复**：被覆盖的报告没有备份。若你此前基于某份报告做过清理决策，
> 建议重新跑一次 `disk-clean scan <盘符>`。审计日志只做了追加，因此没有丢失，但其中混有测试记录。

---

## 二、报告现在有"出处"和"历史"

### 2.1 每处报告输出都会显示生成时间与范围

报告的终端输出此前**完全不显示生成时间**（Markdown 里有，两者用的还不是同一个字段）。
而报告是全局单例——每次扫描直接覆盖，`clean` / `organize` 的候选路径又恰恰取自"最近报告"。
你可能拿着一份三天前的报告做清理决策，界面上却看不出来。

现在这些地方都会显示生成时间、相对时间和扫描范围，**超过 24 小时会明确提示"建议重新扫描"**：

- CLI：`disk-clean scan` 与 `disk-clean report`
- MCP：`disk_scan` / `disk_report` 返回值里新增 `provenance` 字段
- GUI：扫描结果上方显示生成时间

报告文件本身也记下了 `generatedAt` 与工具版本。旧报告会自动回落到 `summary.scannedAt`
（这个字段一直存在），因此**存量报告同样能判断新旧**，不会一律显示"未知"。

### 2.2 报告历史（`retention.reports` 终于生效）

```
disk-clean report --history      # 列出历次扫描的归档（新 → 旧）
disk-clean report <归档文件名>    # 打开某一份
```

- 每次扫描自动归档一份到 `~/.disk-clean/reports/`；
- 只保留最近 **N** 份，`N` 由 `retention.reports` 配置（默认 30）；
- 归档为 **gzip**（一个磁盘清理工具不该为了存历史自己吃掉几百 MB），读取时自动解压；
- MCP 侧：`disk_report` 的 `section` 新增 `history`。

> `retention.reports` 这个配置项从更早的版本就写在默认配置里、README 也提过，
> 但**从来没有任何代码读取它**——"报告历史"这个能力此前并不存在。本版才真正实现。
> 同类问题（配置里写了、描述里承诺了、代码里没有）本次一并清查完毕。

---

## 三、校验你下载到的 exe 是不是本次发布的构建

新增：

```powershell
disk-clean.exe build-info
# {"version":"0.7.1","commit":"<短哈希>","dirty":false,"builtAt":"...","fingerprint":"0.7.1+<短哈希>","form":"sea"}
```

发布页的 `checksums.txt` 每一行也带上了 `commit=`。两者对得上，就说明这份 exe
确实由该提交构建，而不是一个"版本号相同但其实来自另一次构建"的文件——
后者正是 v0.5.0 发生过的事故（发布资产里的校验和描述的是一份已经不存在的构建）。

---

## 四、行为与文档的修正（不影响你的既有用法）

- **CLI 建议行现在显示标题**：此前输出成 `[junk-temp] junk-temp`（读了一个不存在的字段），
  现在是 `[junk-temp] 清理临时与缓存文件`。README 里记录的示例一直是对的，错的是代码。
- **英文 README 顶部新增语言说明**：CLI 的控制台输出与建议标题是**中文**，
  `--lang` 只切换报告的**结构性标签**（Markdown 标题、字段名）。此前的措辞让人以为存在英文界面。
- **报告 Markdown 与终端使用同一个时间字段**，不会再出现两边不一致。

---

## 五、删除两个从未生效的配置项（`config.junkRules` / `config.organizeRules`）

这两个字段从未被任何引擎代码读取，却在 MCP 的工具描述里被当成已有功能承诺
（"自定义垃圾规则与整理映射"）。v0.7.0 处理过同类的 `config.blacklist`，
但当时是**逐项修而不是按类别修**，这两项因此漏网，并且在同一版又被承诺了一遍。

现按本仓库原则（**要么实现、要么从描述里删掉**）删除，并加了类别级守门：
被删掉的字段不得在 README 或任何工具描述里重新出现。

> 如果你在 `~/.disk-clean/config.json` 里设置过它们：请直接删掉这两行。
> 它们此前没有任何效果，删除后也不会有任何变化。

---

## 六、升级方式

| 渠道 | 操作 |
|---|---|
| GUI 安装器 | 下载 `disk-clean-setup-0.7.1.exe` 覆盖安装 |
| 单文件 exe | 下载 `disk-clean-win-x64.exe` 替换旧文件 |
| npm | `npx -y disk-clean@0.7.1 mcp`（或 `npm i -g disk-clean@0.7.1`） |

校验：

```powershell
# 与发布页上的 values 比对
Get-FileHash disk-clean-win-x64.exe -Algorithm SHA256
# 确认制品来自本次 tag 指向的提交
.\disk-clean-win-x64.exe build-info
```

---

## 七、对贡献者：发布流程变了

- **发布需要人工审批**：`scripts/publish-release.ps1` 的第 0 步是
  `node scripts/approval.js check`。没有人工批准（`approval.js confirm --version <v> --by "<名字>"`）
  就直接退出 1，且**审批绑定每个产物的 sha256**——批准后重新构建会导致审批失效，必须重批。
  没有 `--yes` / `--force` 之类的旁路。
- **CI 不再在推 tag 时自动创建 Release**：此前 `git push --tags` 会发布一个未经审批、
  且只有引擎（没有 GUI 安装器）的半成品 Release。现在 CI 只构建 + 断言指纹 + 上传 artifact。
- **发布前置文档是硬性要求**：缺 `docs/RELEASE_NOTES-v<ver>.md` 或 `docs/release-guide-v<ver>.md`，
  发布脚本直接拒绝。
- 日常入口：`node scripts/dev.js doctor` / `verify` / `analyze` / `changelog` / `release-guide`。

详见 `docs/RELEASE-PLAYBOOK.md` §0.1 与 `docs/SOP-UPGRADE-PLAN.md`。
