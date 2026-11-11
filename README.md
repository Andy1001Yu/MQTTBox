# MQTTBox — modern macOS port

基于 [workswithweb/MQTTBox 的 electron_app 分支](https://github.com/workswithweb/MQTTBox/tree/electron_app)，保留原 React 15 / Bootstrap 界面、MQTT 客户端和负载测试功能。这里是非官方 macOS 移植，原作者与版权信息保留。

[下载安装包](https://github.com/Andy1001Yu/MQTTBox/releases/latest) · [构建与测试报告](porting/REPORT.zh-CN.md) · [安全修补记录](porting/SECURITY-REPAIR.md) · [许可说明](porting/LICENSE-REVIEW.zh-CN.md)

## 安装

优先选择 arm64 DMG（Apple Silicon）；Intel Mac 选择 x64。打开 DMG，把 MQTTBox 拖到 Applications。

安装包使用本地 ad-hoc 签名，尚未获得 Apple Developer ID 签名或公证。外部下载后如被系统拦截，请在系统设置的“隐私与安全性”中查看允许打开选项；无需关闭系统 Gatekeeper。

## 功能

- MQTT/TCP、WebSocket、TLS、WSS；MQTT 3.1 与 3.1.1。
- 发布、订阅、通配符、取消订阅、保留消息、QoS 0/1/2、认证、遗嘱、自动重连。
- CA 验证、客户端证书 mTLS；CA-signed 模式现在验证服务器证书。
- 多实例发布/订阅压力测试、停止、超时、归档、数据表与图表。
- 原版配置持久化、消息记录、二进制数值输入、复制与再次发布界面保留。

原默认公共 broker 来自2016年源码，首次连接请填写自己的地址。私有CA使用 CA certificate only 并加载CA；需要客户端证书时使用对应证书模式。现代Node/OpenSSL不支持的旧SSL/TLS选项未重新启用。

## 构建和验证

Node.js >=22.13.0，建议24/26，macOS构建环境。

```sh
npm ci --no-audit
npm start
npm audit --audit-level=low
npm test
npm run test:electron
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
```

产物在 dist/；pack:mac 只生成arm64 .app。使用完整lockfile和明确的安全补丁覆盖，保留原UI框架。构建仍是逐文件CommonJS/JSX编译，已把旧Gulp/Babel6工具替换为Babel7。历史原版命令保存在 [UPSTREAM-README](porting/UPSTREAM-README.md)。

macOS工作流分别使用原生arm64与Intel runner，执行依赖审计、功能测试和桌面回归，生成对应安装包。详见 [.github/workflows/build-macos.yml](.github/workflows/build-macos.yml)。

## 安全与许可

0.2.2-macos.1 修复首版移植保留的21项生产依赖告警；生产与开发完整npm审计均为0（2026-11-11快照）。静态jQuery/Bootstrap资源另行修补，不把npm审计结果等同于完整安全认证。

更新检查仅访问本fork的GitHub HTTPS Release API，不再向旧接口发送MAC/UUID；外部链接限制HTTP/HTTPS；页面CSP阻止未授权脚本执行。具体版本、来源、测试和剩余限制见报告。

Electron应用的原manifest声明MIT，第三方资源有各自许可。完整许可材料随源码和.app附带，见 [porting/licenses](porting/licenses/README.md)。MIT声明不能替代商标授权，也不能把第三方字体或专利条款改标为MIT。
