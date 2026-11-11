# MQTTBox 现代 macOS 移植与验证

原仓库：https://github.com/workswithweb/MQTTBox ，分支 `electron_app`。
基准提交：`6422e4039264183c7cd576b622e567a2d8ab942f`（2016-11-15）。
验证日期：2026-11-11；本机 macOS 27.2 (26B123)，Apple Silicon arm64，Node.js 26.0.0，npm 11.12.1。

## 源码审查与原版尝试

使用完整 `git clone --branch electron_app`，非 shallow；保留所有远程分支和 82 个可达提交。没有用下载 ZIP 或新写界面替代仓库。

原应用为 React 15.3.2、React Router 3、Bootstrap 3.3.7，使用 Flux、localforage/IndexedDB。Electron 主进程接收 renderer IPC，为每个 MQTT 连接和负载实例 fork 独立 Node worker；MQTT.js 2.1.1 执行协议。`src/www/` 提供静态资源及应用 manifest；README 指示 Babel 分别编译 JSX/ES2015 到 CommonJS，再复制静态资源。Gulp 配置则是 Browserify/BrowserSync 的另一套开发流程，没有 Electron 打包配置。

| 原版操作 | 实际结果 | 日志 |
|---|---|---|
| `npm install` | ERESOLVE：Recharts 的 React addon peer 约束与 React 15.3.2 冲突 | [01](logs/01-original-install.log) |
| `npm install --legacy-peer-deps` | 请求 electron-v1.8.8-darwin-arm64.zip，HTTP 404；该旧运行时没有 arm64 包 | [02](logs/02-original-legacy-install.log) |
| `npm start` / Gulp | `require.extensions.hasOwnProperty is not a function`，Node 26 不兼容旧 require-dir | [03](logs/03-original-start.log) |
| README 的 Babel 编译 | 成功，无需升级 Babel 或重写源码 | [04](logs/04-original-babel.log) |
| 原版 `electron ./build` | Electron 安装不完整，无法启动 | [05](logs/05-original-electron.log) |
| 原版窗口入口 + Electron 45 | 空白窗口，`ReferenceError: require is not defined`；默认 nodeIntegration=false、contextIsolation=true、sandbox=true | [10](logs/10-original-on-modern-electron.log) |
| 原版真实 worker 集成测试 | 19/25 通过，6 个压力测试缺陷复现 | [09](logs/09-original-worker-tests.log) |

Electron 45 的下载器改为懒下载。当前网络下载 GitHub 二进制较慢，实际使用 npmmirror 的 Electron 镜像，并以 Electron npm 包附带的官方 SHA-256 清单校验；业务代码和 npm 依赖仍来自原仓库/注册表。初始 sandbox 的代理/本地端口限制不计作应用缺陷。

## 修改范围

- 保留原 React、Router、Flux、Bootstrap、MQTT.js、图表、数据表和全部业务依赖版本，所有原有页面/表单/样式结构保留。
- Electron 固定为 45.3.0，electron-builder 固定为 26.18.0；新增 lockfile 和 `.npmrc` 的旧式 peer 解析。
- `scripts/build.cjs` 自动执行原 README 的 Babel 编译和静态文件复制。旧 Gulp 源码仍保留供核对；现代启动不经过该不兼容流程。
- 主窗口显式恢复原 renderer 的 Node 环境；使用 `loadFile` 和相对模块目录路径，兼容仓库路径中的中文及打包后的 ASAR；旧原生菜单 selector 改为 role。
- 保持 Node 集成的同时限制页面导航和新窗口。没有对 renderer/IPC 进行框架重构。
- 两个主进程服务使用模块目录定位 worker；退出时清除 worker 引用，应用退出时终止子进程。
- 压力 worker 在边界把界面传来的字符串 QoS 转为数字，等待 MQTT 数据发送完成再结束；两个 worker 的最终 IPC 事件发送完成后才退出进程，避免大归档丢失。
- 原版 128px 图标仅缩放并转换为 macOS `.icns`，界面资源未替换。

原版压力失败的具体表现：QoS 0 只到达 broker 31/32 条；字符串 QoS 发布 12 次回调时计数为 11，字符串 QoS 订阅在进入订阅状态前断开；48 × 16 KiB 的最终归档在子进程立即退出时丢失。针对性修复后首轮 25/25 全部通过：[11](logs/11-fixed-worker-tests.log)。

## 测试覆盖

所有协议测试使用本机临时 broker 与临时证书，不依赖公共 MQTT 服务。TLS 测试使用 OpenSSL 生成的测试 CA、服务器 SAN 和客户端证书。

- TCP 连接与发布/订阅 QoS 0/1/2，检查真实协议确认、broker 收包及消息内容。
- 通配符、取消订阅、保留消息、连接 worker 的真实进程 IPC。
- 自定义 CA、客户端证书 mTLS、错误 CA 拒绝、原版跳过校验模式，WS 与 WSS 的 URL 路径和 CA。
- 发布/订阅负载、数字/界面字符串 QoS、消息与归档精确计数、负载停止和超时、大归档 IPC。
- Electron 桌面测试通过原界面创建并保存连接，发布订阅 QoS 2；检查主进程实际 fork 的路径、单消息负载与数据表、进程重启后的 IndexedDB 配置保留及自动重连。测试使用隔离的 `--user-data-dir`，没有写入个人 MQTT 配置；旧版本检查由临时 HTTP 代理返回 204。

完整构建、最终安装包与补充测试的实测结果见本文末尾的交付记录。

## 复现

在当前修改后的完整仓库目录执行；建议使用 Node.js 22 或更高版本，本次实测为 26.0.0。

```sh
npm ci --no-audit
npm run build
npm start
npm test
npm run test:electron
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
```

`npm run dist:mac` 生成 arm64 和 x64 独立 DMG，以及对应 `.app`。如只需本机 arm64 `.app`，使用 `npm run pack:mac`。网络正常时使用默认 Electron 官方下载源；若相同环境下载缓慢，可在下载/打包命令前加：

```sh
export ELECTRON_GET_USE_PROXY=1
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_CUSTOM_DIR='{{ version }}'
```

无需镜像时不设置这些变量。Electron 安装器会核对其包内的校验清单。

对已打包 app 复测真实界面与 worker：

```sh
MQTTBOX_EXECUTABLE="$PWD/dist/mac-arm64/MQTTBox.app/Contents/MacOS/MQTTBox" npm run test:electron
MQTTBOX_EXECUTABLE="$PWD/dist/mac/MQTTBox.app/Contents/MacOS/MQTTBox" npm run test:electron
```

x64 包在 Apple Silicon 上运行需要系统已有 Rosetta；Intel 原生验证应在 Intel Mac 上执行同样测试。所有结果要区分“交叉构建成功”“Rosetta 运行成功”和“Intel 实机成功”。

## 保留的限制与许可

- 本地构建使用 ad-hoc 签名，不使用 Developer ID，也未提交 Apple 公证。签名完整性检查通过不等于 Gatekeeper 认可的正式分发签名；从外部下载的副本可能需要用户通过系统“隐私与安全性”允许打开。没有更改系统 Gatekeeper 配置。
- 为保留原版架构，renderer 继续启用 Node，未迁移到隔离 preload；依赖中仍有已停止维护的旧库和已知安全问题。此次不是全面依赖升级或安全认证。
- 原版 TLS `certificateType=cssc`（界面“CA signed server certificate”）设置 `rejectUnauthorized=false`，会接受不受信任的证书。测试明确验证了这一原行为。需要校验服务器身份时使用“CA certificate only”并提供可信 CA，或配置证书的自签名模式。TLS 1.0/1.1/SSLv3 等旧选项受现代 Node/OpenSSL 限制，不为兼容而降低系统安全级别。
- 原版 load worker 的 TLS 配置能力少于普通客户端，负载表单没有客户端 CA/证书/密钥输入。未把它扩展为新的功能。
- 默认远程 broker `iot.eclipse.org`、版本检查及帮助/下载 URL 来自旧源码；未证明这些历史服务仍可用。本地测试不会依赖它们。首次连接应填写自己的 broker 地址。
- virtual-device 源文件是上游未完成占位功能，并非本次移植移除了可用功能。
- Electron 应用 manifest 声明 MIT，但原仓库缺少完整统一许可正文；已保留原版权并补齐直接附带资源的许可全文。MIT 不提供商标授权，Font Awesome 字体适用 OFL，FixedDataTable 0.6.3 另附 BSD/PATENTS。详细证据及分发条件见 [许可审计](LICENSE-REVIEW.zh-CN.md)，随包材料见 [licenses](licenses/README.md)。

## 最终交付记录

最终双架构构建成功（exit 0）：[完整构建日志](logs/22-final-mac-build.log)。

| 产物 | 大小 | 运行与验证 |
|---|---:|---|
| arm64 DMG（首版产物仅本地存档） / arm64.app（首版产物仅本地存档） | 127,193,864 字节 | Apple Silicon 原生：完整桌面测试、包内 worker 全35项协议测试通过 |
| x64 DMG（首版产物仅本地存档） / x64.app（首版产物仅本地存档） | 134,167,615 字节 | Apple Silicon 上 Rosetta x64：完整桌面测试通过；包内协议串行复测32/35通过，3项超时；未做 Intel 实机验证 |

两包 Info.plist 的最低 macOS 声明均为13.0；本次实测系统只有27.2，不据此声称已在13–26逐个实测。两种可执行文件经 file 确认为各自 arm64/x86_64；codesign --verify --deep --strict 均通过（ad-hoc）。两DMG经 hdiutil verify 校验和只读挂载，内部.app可执行文件/ASAR与实测版本逐字节SHA-256一致，Applications快捷链接存在，验证后均已卸载。两包 ASAR内容哈希相同：6719b3ccba4c703992113d4ce87604d08bab9f19148f8da796c236607e28adcd。

- [源码worker最终35/35](logs/21-final-tests.log)，包含认证、MQTT3.1、LWT、重连、10实例 ×500条=5000条真实QoS1消息及十份完整归档。
- [arm64成品桌面测试](logs/23-packaged-arm64.log)；[x64成品桌面测试](logs/24-packaged-x64.log)。检查实际.app内的ASAR worker路径，完整关闭后再次启动验证持久化。
- [arm64包内worker 35/35](logs/25-packaged-arm64-protocol.log)；[x64包内worker串行32/35](logs/27-packaged-x64-protocol.log)。测试使用各成品自身的Electron/Node运行时和ASAR中的生产代码，测试broker和断言代码来自仓库test目录。
- [签名、DMG挂载与哈希证据](logs/26-artifact-verification.log)；机器可读产物清单（首版产物仅本地存档）；DMG SHA256SUMS（首版产物仅本地存档）。
- [完整桌面截图](screenshots/)包含开发版、arm64成品、x64成品各5张。

独立审查发现“优雅关闭在ACK丢失时阻塞取消”的回归后，新增4个真实TCP broker扣留PUBACK/PUBCOMP的Stop/Timeout用例；[修复前4/4失败](logs/18-cancel-red.log)，最终均通过。只有成功结束等待数据发送；Stop/Timeout强制关闭。arm64原生测试已通过；x64/Rosetta的性能与测试覆盖限制如下。

x64/Rosetta补充协议测试存在未解决的时限问题：首轮并行执行17通过、17失败、1取消（[原始日志](logs/27a-packaged-x64-parallel-attempt.log)）；保持相同断言与超时值、使用 --test-concurrency=1 复测为32通过、3失败，耗时102秒。失败为10实例×500条的压力测试等待终止事件超时，以及两项ACK丢失超时测试未在设定时间进入acknowledgement-held阶段。其余连接、QoS、TLS/mTLS、WS/WSS、普通负载、Stop、归档、认证、MQTT3.1、LWT和重连均通过。两项ACK测试配置的负载timeOut为0.25秒，Rosetta下建立连接可能先耗尽此时间，故没有证明它们进入了原生测试中的同一丢ACK场景。尚未确认更深层性能原因；不修改业务代码或放宽断言来掩盖失败。优先使用arm64包，Intel原生性能仍需Intel实机复测。

复现该x64补测：

```sh
ELECTRON_RUN_AS_NODE=1 MQTTBOX_TEST_BUILD_DIR="$PWD/dist/mac/MQTTBox.app/Contents/Resources/app.asar/build" ./dist/mac/MQTTBox.app/Contents/MacOS/MQTTBox --test --test-concurrency=1 test/*.test.cjs
```

生产依赖npm审计仍报告21项：3 critical、14 high、4 moderate；这是保留旧版业务依赖的明确限制，不代表35项功能测试验证了安全性。[审计JSON](logs/production-audit.json)。原版cssc模式跳过服务器验证、旧TLS选项及历史远端URL等限制见上节；本次没有把这些兼容性移植扩展为全面安全重构。

实际构建复用了经过官方npm清单核验的缓存zip，命令为：

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac dmg --arm64 --x64 --publish never -c.electronDist=/private/tmp/mqttbox-electron-45.3.0-20261111
```

该临时目录仅含已验证缓存的两个zip链接；在其他机器无需这个路径，使用上文npm run dist:mac由builder下载对应运行时即可。包内协议复测示例：

```sh
ELECTRON_RUN_AS_NODE=1 MQTTBOX_TEST_BUILD_DIR="$PWD/dist/mac-arm64/MQTTBox.app/Contents/Resources/app.asar/build" ./dist/mac-arm64/MQTTBox.app/Contents/MacOS/MQTTBox --test test/*.test.cjs
```
