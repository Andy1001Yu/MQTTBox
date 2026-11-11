# Security repair for the modern macOS port

Release: 0.2.2-macos.1. Upstream: workswithweb/MQTTBox electron_app at 6422e4039264183c7cd576b622e567a2d8ab942f.

- Preserve React 15, React Router 3, Flux, Recharts 0.18 and the original UI.
- Replace the retired request/getmac telemetry chain with anonymous HTTPS GitHub release checks; never send MAC addresses.
- Upgrade lodash to 4.18.1, moment to 2.31.0, MQTT.js within 2.x to 2.18.9; apply explicit compatible overrides for ws, node-fetch and d3-color.
- Remove unused Gulp/Browserify tooling; preserve the separate CommonJS/JSX build using Babel 7.
- Enable certificate verification in the original CA-signed mode; preserve custom CA and mTLS.
- Preserve QoS 2 archive payloads across the MQTT callback change, and never count failed callbacks as acknowledgements.
- Restrict external link schemes and apply a Content Security Policy with the exact hash of the existing inline compatibility script.
- Patch the vendored jQuery/Bootstrap resources separately from npm auditing, preserving only the Bootstrap JS modules the app uses.

Evidence so far: baseline production audit 21 affected-package entries; repaired production and full dependency audits both 0 (logs/security/04-production-audit.json and logs/security/10-final-audit.json). Full regression 71/71, including 35 security checks (logs/security/11-full-regression.log). Final vendor/CSP checks and both arm64/x64 packaged UI suites passed. The arm64 app runtime passed all 71 tests using code from its ASAR. Both DMGs passed deep signature checks and read-only mounting/content verification. GitHub publication is the remaining delivery step.

The historical porting report and its original errors remain in BASELINE-REPORT.zh-CN.md. Audit results describe known advisories in the resolved npm tree at the time of execution; vendored browser assets are checked and recorded separately.
