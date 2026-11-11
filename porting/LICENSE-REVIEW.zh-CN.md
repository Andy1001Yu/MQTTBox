# MQTTBox 移植许可材料核对

核对日期：2026-11-11。原始代码基准：`electron_app` / `origin/electron_app`，提交 `6422e4039264183c7cd576b622e567a2d8ab942f`。

**结论：Electron 应用 manifest 声明 MIT；仓库没有完整、统一的许可文件。** 本次移植在 `porting/licenses/` 补充标准许可正文、原有声明及第三方通知。新增材料明确注明来源，不能据此扩大原作者的授权范围，也不能将所有第三方内容改标为 MIT。

## 原仓库证据

- `src/www/package.json:7`：`"copyright": "© 2016, Workswithweb inc."`。
- `src/www/package.json:9`：`"license": "MIT"`。这两个字段自 `7e8e2bc4ae0416e0dca80ec3b27f632ed393c49b`（2016-09-15，首次加入此文件）即存在，所查历史没有撤销这一声明。
- 根 `package.json` 没有 `license` 字段；第 12 行的 `"private": true` 用于阻止 npm 发布。它本身不是禁止修改或发行的版权许可条款。[npm 的 license 与 private 字段说明](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)
- `README.md:5` 指示将 `www` 内容复制到构建目录，`src/www/package.json` 的名称、产品名称和入口也对应 MQTTBox 桌面应用。此 manifest 是实际应用的 MIT 声明证据；仓库没有进一步说明该声明对其他分支、根构建工具、Logo 或商标的覆盖范围。[上游固定提交中的 manifest](https://github.com/workswithweb/MQTTBox/blob/6422e4039264183c7cd576b622e567a2d8ab942f/src/www/package.json)

所查克隆不是 shallow，有 82 个可达提交，无 tag。对四个远端分支的树及全部可达历史对象路径进行核对，均未发现独立的 `LICENSE`、`COPYING`、`NOTICE`、`COPYRIGHT` 或 `PATENTS` 文件。这里的“未发现”只指原始 Git 跟踪内容，不包括此次移植新增材料和后来安装的 `node_modules`。

| 原始远端分支 | 核对提交 | 顶层/应用许可声明 |
|---|---|---|
| `origin/electron_app` | `6422e4039264183c7cd576b622e567a2d8ab942f` | 应用 `src/www/package.json` 声明 MIT；根 manifest 无声明 |
| `origin/master` | `c6c9724af563d0e585408c713fa20c244c03ef99` | 根 manifest、README 未见统一许可声明；无应用 manifest |
| `origin/chrome_app` | `37c6a13b6564c4d74484ceb0f31ac836c5383556` | 根 manifest、README 未见统一许可声明；无应用 manifest |
| `origin/web_app` | `3140e3e3d3e1b4768945f4d3d5f972083810738c` | 根 manifest、README 未见统一许可声明；无应用 manifest |

复核命令包括：`git rev-parse --is-shallow-repository`、`git rev-list --all --count`、`git ls-tree -r --name-only <ref>`、`git rev-list --objects --all`、`git log --all -p -G 'license|copyright' -- package.json src/www/package.json`。

公开仓库本身不会产生通用的复制、修改或发行许可，不能用 GitHub 的公开状态弥补尚未明确的授权范围。[GitHub 官方说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

## 本次补充材料与第三方资源

`licenses/SOURCES.json` 记录每份文本的来源 URL、文件类型、字节数和 SHA-256。下载自版本化上游的许可文件保持原始字节；由本次移植汇编的说明文件均在文件开头标注为补充材料。

| 组件/原始本地证据 | 实际声明 | 已保存材料 |
|---|---|---|
| MQTTBox：`src/www/package.json:7,9` | MIT | [基于 manifest 的 MIT 补充记录](licenses/MQTTBox-manifest-MIT-supplement.txt)，不是上游原有 LICENSE，也不是新的全仓授权 |
| Bootstrap 3.3.7：`src/www/lib/bootstrap/css/bootstrap.min.css:2-4`、JS 头部 | MIT | [官方 v3.3.7 LICENSE 全文](licenses/bootstrap-3.3.7-LICENSE.txt) |
| normalize.css 3.0.3：Bootstrap CSS 第 5 行内嵌头部 | MIT | [官方 3.0.3 LICENSE 全文](licenses/normalize-3.0.3-LICENSE.txt) |
| jQuery 3.1.0：`src/www/lib/jquery.min.js:1` | 版权头指向 MIT 许可页面 | [官方 3.1.0 LICENSE.txt 全文](licenses/jquery-3.1.0-LICENSE.txt) |
| Font Awesome 4.6.3 CSS：`src/www/lib/fontawesome/css/font-awesome.min.css:2-3` | CSS 为 MIT | [原有署名与标准 MIT 正文补充](licenses/font-awesome-4.6.3-CSS-MIT-supplement.txt) |
| Font Awesome 4.6.3 字体：同一 CSS 头部、官方对应版本 README、字体 name 表 | 字体为 SIL OFL 1.1 | [字体原有版权及完整 OFL 正文补充](licenses/font-awesome-4.6.3-font-OFL-supplement.txt)；[上游品牌图标通知](licenses/font-awesome-4.6.3-BRAND-NOTICE.txt) |
| Bootstrap 附带 Glyphicons Halflings：字体 name 表、官方对应版本组件文档 | Bootstrap 的附带字体使用说明 | [原字体版权和上游说明来源](licenses/bootstrap-3.3.7-GLYPHICONS-NOTICE.txt)；没有自行授予独立字体许可 |
| FixedDataTable 0.6.3：`src/www/lib/fixed-data-table.css:4-9` | BSD-style 与额外专利授权 | [官方 v0.6.3 LICENSE 全文](licenses/fixed-data-table-0.6.3-LICENSE.txt)、[官方 PATENTS 全文](licenses/fixed-data-table-0.6.3-PATENTS.txt) |

Font Awesome 4.6.3 的 [README](https://github.com/FortAwesome/Font-Awesome/blob/v4.6.3/README.md#license) 与许可页源码给出 MIT/OFL 1.1 声明及链接，没有在该文档中附完整正文。补充记录因此组合版本化声明与标准许可正文，并明确说明组合方式。原字体内置版权为 `Copyright Dave Gandy 2016. All rights reserved.`；本地 `FontAwesome.otf` 与官方 v4.6.3 同路径文件逐字节相同，SHA-256 为 `ecd72f31910a8ee2726fd17bd459be26f230779f3f3ed5f69ebf829e4b12e768`。

标准 [MIT](licenses/MIT-standard-reference.txt) 与 [OFL 1.1](licenses/OFL-1.1-standard-reference.txt) 取自 SPDX 官方数据库的固定提交 `31846481de7ea17d92f2f46fad76abe58b2e9bb0`。MIT 参考文件保留标准占位符；它本身不是任一组件的版权声明。具体组件通知和版权记录另存。SIL 官方 OFL 下载端点对本次直接下载返回 HTTP 403，故使用 SPDX 的完整标准版本，并对照 [SIL 官方 OFL 1.1 正文](https://openfontlicense.org/open-font-license-official-text/) 核对条款。

## 发行时需要保留的内容

MIT 允许修改、分发及商业用途，附带的版权与许可通知需要保留。FixedDataTable 的 BSD 条件要求在源码或二进制发行附带材料中保留版权、条件和免责声明，并限制未经许可使用 Facebook/贡献者姓名背书；其专利授权另有终止条款，完整内容已单独保存。OFL 字体需要携带版权与 OFL 正文，不能单独销售字体，修改时还需遵守保留字体名等适用条件；这些要求不将应用其余代码变成 OFL。

打包应包含整个 `porting/licenses/`，并保留原始资源中的版权头和字体元数据。这里补齐的是直接随仓库提交的资源材料；npm 依赖本身及其嵌套依赖仍使用各自随包的许可，由打包流程保留。本次记录没有完成所有 npm 传递依赖的逐项法律审查，也没有取得原作者对全仓许可范围或品牌使用的额外确认。

## 安全修补版的资产变更（0.2.2-macos.1）

本报告上文核对的是固定提交中的原版资产。当前分支已把jQuery更新到官方3.7.1，把Bootstrap CSS更新到官方3.4.1；JS仅包含官方原文transition、collapse、dropdown三个模块，排除应用未使用且仍有已知问题的插件。两份新版MIT许可证已附带，原字体、normalize和其他组件条款继续保留。现行资产的原始URL、精确SHA-256和拼装偏移见[SECURITY-VENDOR-SOURCES.json](licenses/SECURITY-VENDOR-SOURCES.json)，说明见[SECURITY-VENDOR-NOTICE.md](licenses/SECURITY-VENDOR-NOTICE.md)。旧版许可证只为原仓库证据保留，不表示仍打包旧版脚本。
