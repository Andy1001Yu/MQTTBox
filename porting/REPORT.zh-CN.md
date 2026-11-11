# MQTTBox 0.2.2-macos.1：现代macOS构建与安全修补

日期：2026-11-11。原仓库[workswithweb/MQTTBox](https://github.com/workswithweb/MQTTBox)，electron_app基准提交6422e4039264183c7cd576b622e567a2d8ab942f。完整克隆保留全部远端分支和82个可达提交，非shallow。

当前分支macos-modern保留原React15、Router3、Flux、Recharts及页面结构，完成兼容修复后再依据安全审计升级必要依赖。没有重写应用。首次原版安装、Gulp错误、Electron1.8.8 arm64下载404、原Babel成功编译及原版worker19/25结果，完整保存在[首版报告](BASELINE-REPORT.zh-CN.md)和[上游README](UPSTREAM-README.md)。

## 安全修补结果

- 原21项是受影响npm包记录，其中含同一底层通告向上层依赖传播的计数。修补后[生产审计0](logs/security/04-production-audit.json)、[完整开发+生产审计0](logs/security/10-final-audit.json)。结果对应本次固定lockfile与当日通告数据库，不把它当作完整安全认证。
- 删除废弃request/getmac网络链，保留更新通知，改为仅向本fork GitHub Release API发匿名HTTPS GET，禁止跳转与凭据，5秒超时，校验JSON、版本格式和响应URL。不会发送MAC、UUID或连接配置。
- CA-signed模式现在真正验证服务器证书；自定义CA与mTLS保留。MQTTS/WSS拒绝不可信证书有真实broker回归；没有通过降低TLS版本或关闭验证来兼容。
- 页面CSP限制脚本为本地文件及原有唯一inline兼容片段的精确SHA256；外部链接仅HTTP/HTTPS。真实DOM脚本注入从red到green验证。
- 静态浏览器资源另行升级为jQuery3.7.1、Bootstrap3.4.1 CSS与仅transition/collapse/dropdown模块，删除未使用的tooltip/popover等实现；菜单与消息折叠实际点击回归。

| 范围 | 当前版本/处理 |
|---|---|
| Electron / builder | 45.3.0 / 26.18.0 |
| lodash / moment | 4.18.1 / 2.31.0 |
| MQTT.js / ws | 2.18.9（保留2.x API）/ 5.2.7 |
| isomorphic-fetch链 | 定向覆盖node-fetch2.7.0，保留React15/Flux API |
| 图表颜色解析 | 定向覆盖d3-color3.1.0，已做真实renderer图表验证 |
| 构建工具 | 删除未用Gulp/Browserify依赖，Babel7逐文件编译CommonJS+classic JSX |
| 开发工具补丁 | 仅builder依赖链使用minimatch11.0.8，测试broker的uuid11.1.1 |

MQTT升级后，错误publish回调不计入ACK，QoS2归档使用本次发布时捕获的原payload。原版的字符串QoS、QoS0末条消息、最终IPC大归档丢失和零步长图表问题也已修补。审查发现的取消等待丢失ACK回归有4项真实扣留PUBACK/PUBCOMP的测试，成功关闭和取消关闭分别处理。

## 实际验证

本地：macOS27.2 (26B123)、Apple Silicon、Node26.0.0、npm11.12.1。

| 检查 | 实际结果/证据 |
|---|---|
| 干净安装 | npm ci成功；[日志](logs/security/12-clean-install.log) |
| 完整源码回归 | 71/71，0失败；[日志](logs/security/13-final-regression.log) |
| arm64成品内运行时/ASAR代码 | 71/71，0失败；[日志](logs/security/19-packaged-arm64-tests.log) |
| 开发版完整UI与CSP | 通过；[日志](logs/security/14-final-ui-development.log) |
| arm64 / x64成品完整UI | 两种均完整通过（版本0.2.2-macos.1）；[arm64日志](logs/security/16-ui-arm64.log)、[x64日志](logs/security/17-ui-x64.log) |
| 双架构打包 | 成功；[日志](logs/security/15-final-build.log) |
| DMG与签名 | 两种架构、codesign深度严格校验、hdiutil校验及只读挂载内容比对通过；[日志](logs/security/18-artifact-verification.log) |

协议覆盖TCP、QoS0/1/2协议确认、认证、MQTT3.1/3.1.1、通配符/取消/保留消息、遗嘱、断线重连、TLS自定义CA与mTLS、WS/WSS。负载覆盖10实例各500条真实QoS1消息和全部归档、停止/超时、ACK缺失取消、大IPC归档。安全单测覆盖更新API参数隐私、版本顺序、错误/恶意响应和外链限制。

UI测试使用临时用户目录和本地broker，不修改个人连接配置；通过真实界面保存配置、QoS2往返、负载Data/Graph、下拉菜单/消息折叠、完整关闭重启后的持久化与自动重连。GitHub API由测试本地拦截，不接触旧遥测服务。成品测试加载.app内部app.asar的worker，而非从仓库借用worker。测试兼容打包后的Electron启动参数行为，所有远程请求仍由临时本地代理/route封闭。

## 产物

最低系统声明macOS13.0。本机已验证27.2；GitHub工作流另配原生macOS15 arm64和Intel runner，实际结果见仓库Actions记录，不把Rosetta运行等同于Intel实机验证。

| 架构 | 安装包 | 字节数 | SHA256 |
|---|---|---:|---|
| arm64 | [MQTTBox-0.2.2-macos.1-mac-arm64.dmg](https://github.com/Andy1001Yu/MQTTBox/releases/download/v0.2.2-macos.1/MQTTBox-0.2.2-macos.1-mac-arm64.dmg) | 127037474 | 4ca7c567d9f7fb943733245adeb9c8eee19e740613d4c26ae6ffaa1eb5c1c2d8 |
| x64 | [MQTTBox-0.2.2-macos.1-mac-x64.dmg](https://github.com/Andy1001Yu/MQTTBox/releases/download/v0.2.2-macos.1/MQTTBox-0.2.2-macos.1-mac-x64.dmg) | 134008287 | 3dfbfdd5634f29abec4a58a52abc61ef8f07b7bf7178e8fd4daa572802de41fc |

[机器可读清单](ARTIFACTS.json)记录.app路径、ASAR哈希、版本与签名状态。DMG内部的可执行文件/ASAR与测试.app内容相同；验证后挂载均已卸载。当前.app路径为dist/mac-arm64/MQTTBox.app与dist/mac/MQTTBox.app，.app也包含在各自DMG中。

## 复现

Node>=22.13.0，建议24/26。执行：

```sh
npm ci --no-audit
npm audit --audit-level=low
npm test
npm run test:electron
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
python3 scripts/verify-macos-artifacts.py
MQTTBOX_EXECUTABLE="$PWD/dist/mac-arm64/MQTTBox.app/Contents/MacOS/MQTTBox" npm run test:electron
ELECTRON_RUN_AS_NODE=1 MQTTBOX_TEST_BUILD_DIR="$PWD/dist/mac-arm64/MQTTBox.app/Contents/Resources/app.asar/build" ./dist/mac-arm64/MQTTBox.app/Contents/MacOS/MQTTBox --test --test-concurrency=1 test/*.test.cjs
```

默认使用官方Electron下载源。当前网络实际构建复用了按官方npm包SHA256校验的arm64/x64缓存zip；其校验值在[RUNTIME-CHECKSUMS.json](RUNTIME-CHECKSUMS.json)。若Github二进制下载缓慢，可临时设置ELECTRON_GET_USE_PROXY=1、ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/、ELECTRON_CUSTOM_DIR='{{ version }}'，下载器仍核对官方包内清单。实际使用builder的electronDist指向这些已校验缓存，见打包日志。

## 许可与范围

应用原manifest声明MIT；原仓库缺少统一完整许可文件，这一事实及第三方分发条件见[许可审计](LICENSE-REVIEW.zh-CN.md)。原版权头、字体元数据、MIT/BSD/OFL/FixedDataTable PATENTS及新版资源许可证随包附带。现代静态资源的官方URL、文件哈希、JS模块拼装偏移在[SECURITY-VENDOR-SOURCES.json](licenses/SECURITY-VENDOR-SOURCES.json)，未重新授予品牌或第三方素材许可。

安装包为ad-hoc签名，没有Developer ID签名或Apple公证。保留原架构意味着renderer仍有Node集成，仍使用部分停止维护的UI库；修补当前已知通告和CSP不等同于隔离preload重构。旧SSL/TLS选项受现代OpenSSL限制，不重新启用；负载表单仍没有普通客户端的完整证书输入界面。原公共broker地址和部分历史帮助链接可失效，请填写自己的broker。virtual-device文件是上游未完成功能，不宣称此次补成。首版Rosetta的高负载/极短时限失败保留在基线报告，本版优先arm64，原生Intel结果由CI另行核实。

## GitHub交付

目标：[Andy1001Yu/MQTTBox](https://github.com/Andy1001Yu/MQTTBox)，分支macos-modern，Release标签v0.2.2-macos.1。源代码保留上游历史，安装包附SHA256清单；具体发布状态在最终交付时核对。发布前日志中的本机用户名/私人目录已脱敏，原始日志仅留本地git忽略目录。

## CI可移植性修正

首轮原生macOS15 CI中，arm64为68/71、Intel为63/71，零告警审计均通过。保留[arm64失败](logs/security/20-ci-first-arm64-failures.log)、[Intel失败](logs/security/20-ci-first-x64-failures.log)。随后独立OpenSSL严格校验证实测试CA缺少KeyUsage，LibreSSL链还缺SKI/AKI；补齐后server/client严格校验均通过（[red](logs/security/24-tls-ca-strict-red.log)、[green](logs/security/25-tls-ca-strict-green.log)），没有关闭生产TLS校验。

CI改为测试文件串行执行，取消测试先确认真实ACK被持有，再严格测量原生产2秒总超时与最多1.2秒终止余量；10实例保留5000条精确送达/归档，使用产品默认30秒超时和父35秒上界，不把请求的1.5秒发送节奏当作硬件性能断言。隔离Node24.22.2本地完整71/71通过：[日志](logs/security/27-node24-full-regression.log)。这轮只改测试/工作流，生产源码、依赖与已上传安装包保持一致；原生CI复核结果见Actions。

测试证书最终使用fixture私有openssl.cnf，CA扩展只定义一次，不再把-addext追加到系统默认v3_ca。已识别的兼容机制见[OpenSSL上游问题14457](https://github.com/openssl/openssl/issues/14457)。原生产TLS验证和安装包未改；最终本地必要回归仍为71/71（[日志](logs/security/34-final-necessary-regression.log)）。临时深度诊断工作流已移除，仅保留正常双架构构建工作流；历史失败证据未删除。

## 收尾交付

[Release v0.2.2-macos.1](https://github.com/Andy1001Yu/MQTTBox/releases/tag/v0.2.2-macos.1)已正式发布，标签指向b88213c346387d3438a8259aadebd3362390ff85。两份DMG、审计与清单的GitHub摘要/大小/上传状态已逐项比对本地，全部相符，见[GITHUB-DELIVERY.json](GITHUB-DELIVERY.json)。最后必要本地回归71/71，双包UI验证及完整npm审计0的结果保持。收尾核对时[最终云端CI](https://github.com/Andy1001Yu/MQTTBox/actions/runs/43011818395)仍在运行，未将其计为通过；历史诊断失败已保留，不再追加调查。
