Run the real worker regression suite after compiling `src/app` to `build`:

```sh
node --test test/mqtt-*.test.cjs
```

The suite uses the application's installed `mqtt` package, `aedes@0.51.3` and
`websocket-stream`. TLS fixtures are generated with the local `openssl` command
in a temporary directory and removed after the tests. All broker listeners bind
to ephemeral loopback ports; no public broker, application profile or saved
connection is used.

Coverage includes TCP QoS 0/1/2 and acknowledgement packets, matching wildcard
filters, unsubscribe, retained messages, child worker IPC, trusted and untrusted
TLS, mutual TLS, explicit self-signed mode, WS/WSS, real publish/subscribe loads,
UI string QoS values, partial stop, timeout, and a large IPC archive.

Tests assert intended behavior against the original workers. Failures are
regressions to investigate, not an instruction to replace the worker or its MQTT
dependency. In particular, an acknowledgement must not erase an archived
payload, a string form value must negotiate the requested QoS, and a worker must
flush its complete terminal IPC message before exiting.

Packaged worker testing: set MQTTBOX_TEST_BUILD_DIR to the .app/Contents/Resources/app.asar/build directory and run the corresponding executable with ELECTRON_RUN_AS_NODE=1 and --test. x64/Rosetta sequential reproduction uses --test-concurrency=1; see porting/REPORT.zh-CN.md for 32/35 results and three timing failures. Original cssc mode disables server verification despite its CA-signed label; the legacy acceptance test documents that behavior.
