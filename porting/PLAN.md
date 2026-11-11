# MQTTBox macOS 移植执行记录

基准：完整克隆 electron_app，6422e4039264183c7cd576b622e567a2d8ab942f；用户授权先审查、运行原版、依据错误最小修复并生成本地安装包。

- [x] 完整克隆，核对非 shallow、所有远程分支及原始配置。
- [x] 原版 npm install：ERESOLVE，记录 logs/01-original-install.log。
- [x] 原版 legacy-peer-deps 安装、npm start、README Babel 构建及 Electron 启动尝试，保留错误日志。
- [x] 以实际错误确定范围：保留全部 components/models/services/workers；只调整工具链、Electron 接口及实测阻断缺陷。
- [x] 配置 electron-builder，arm64 优先；尝试 x64 独立包。
- [x] 使用本地 broker 测试真实 worker 的连接、发布、订阅、QoS、TLS、WebSocket、负载、停止及超时。
- [x] 实际 Electron 窗口与打包后应用测试：渲染、界面交互、IPC、存储、图表和 worker 生命周期。
- [x] 验证 .app/.dmg、架构、签名状态，记录复现命令、限制和许可。

约束：不更换 UI 框架；不改协议与业务设计；测试仅访问本地 broker；不发布、不上传、不使用签名凭据。
重点：打包后 fork 路径、Node 集成、TLS 证书、压力测试归档完整性、短运行图表。
独立工作：源码审计只读；许可审计只写 porting/licenses 和许可报告；测试协作者只写 test/；主代理维护构建与生产代码。

验证进度：完整35项协议/压力/取消回归全部通过（logs/21-final-tests.log）；开发版完整Electron UI通过（logs/20-electron-complete.log）。图表一行修复前后已验证。独立审查发现的ACK丢失取消回归通过4项red→green修复。最终成品验证结果见下。

最终结果：双架构.app/.dmg构建、签名验证、只读挂载与内容比对通过；arm64原生与x64 Rosetta成品均通过完整UI测试；arm64包内35项协议通过，x64包内协议串行32/35，3项超时已作为未解决问题记录。许可和21项生产依赖审计警报已列入报告。

安全修补与GitHub交付：生产21→0，全量0；71/71回归；vendor/CSP真实UI通过；0.2.2-macos.1两架构DMG签名/挂载/内容比对通过，arm64包内71/71、两种成品完整UI通过。待推送macos-modern和发布Release并核对远端产物。
