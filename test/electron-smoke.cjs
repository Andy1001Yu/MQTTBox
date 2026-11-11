'use strict';

// Run after npm run build. Override MQTTBOX_EXECUTABLE to test the executable
// inside an installed/package .app, including an x64 build under Rosetta.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {_electron} = require('playwright');
const {assertIsolated, closeElectron, deadline, startFixture, until} = require('./electron-fixture.cjs');

const root = path.resolve(__dirname, '..');
const expectedVersion = require(path.join(root, 'package.json')).version;
const screenshots = path.join(root, 'porting', 'screenshots');
let application;
let fixture;
let currentPage;
const pageErrors = [];
const childPids = new Set();

async function launch() {
  const requestsBeforeLaunch = fixture.apiRequests.length;
  const proxyRequestsBeforeLaunch = fixture.proxyRequests.length;
  const executablePath = process.env.MQTTBOX_EXECUTABLE || require('electron');
  application = await _electron.launch({
    executablePath,
    args: [
      '--require', path.join(__dirname, 'electron-fixture.cjs'),
      `--user-data-dir=${fixture.userData}`,
      `--proxy-server=${fixture.proxyUrl}`,
      ...(process.env.MQTTBOX_EXECUTABLE ? [] : [root])
    ],
    cwd: root,
    env: fixture.env,
    timeout: 30000
  });
  const info = await application.evaluate(({app}) => ({
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
    version: app.getVersion(),
    packaged: app.isPackaged,
    arch: process.arch,
    electron: process.versions.electron
  }));
  assertIsolated(info.userData, fixture.userData);
  assert.equal(info.version, expectedVersion, 'the executable must contain the current release');
  if (process.env.MQTTBOX_EXECUTABLE) assert.equal(info.packaged, true);
  const windowsBeforeRoutes = await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length);
  const routesBeforeWindow = windowsBeforeRoutes === 0;
  if (!routesBeforeWindow) {
    assert.equal(info.packaged, true, 'development launches must install routes before window creation');
    // Packaged Electron ignores CLI --require. The CLI Chromium proxy still
    // applies before startup, and its CONNECT handler never opens an upstream
    // socket. Prove the first release check was blocked there, then install
    // routes and safely reload the real app's first window.
    await until(() => fixture.proxyRequests.slice(proxyRequestsBeforeLaunch)
      .some(url => url === 'api.github.com:443'), 'local proxy rejects the packaged startup GitHub CONNECT');
    fixture.startupProxyBlocks.push(info.arch);
    console.log('Packaged startup GitHub CONNECT refused by the local-only proxy; routes will precede a safe reload.');
  }
  await application.context().route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (url === 'https://api.github.com/repos/Andy1001Yu/MQTTBox/releases/latest') {
      fixture.apiRequests.push({url, method: route.request().method()});
      return route.fulfill({status: 404, contentType: 'application/json',
        headers: {'access-control-allow-origin': '*'}, body: '{"message":"Not Found"}'});
    }
    fixture.blockedRequests.push(url);
    return route.fulfill({status: 204, body: ''});
  });
  if (routesBeforeWindow) await application.evaluate(() => globalThis.__mqttboxSmokeReleaseReady());
  currentPage = await application.firstWindow();
  currentPage.setDefaultTimeout(15000);
  currentPage.on('pageerror', error => pageErrors.push(error.message));
  application.process().stderr.on('data', chunk => {
    if (/Error|error|Cannot|ERR_/.test(chunk.toString())) process.stderr.write(chunk);
  });
  if (!routesBeforeWindow) await currentPage.reload();
  await currentPage.locator('#app .navbar').first().waitFor();
  await until(() => fixture.apiRequests.length > requestsBeforeLaunch,
    'the first release check is intercepted before the renderer accesses the network');
  console.log(routesBeforeWindow
    ? 'GitHub release check intercepted; its route was installed before window creation.'
    : 'GitHub release check intercepted after reloading the proxy-protected packaged window.');
  assert.equal(await currentPage.title(), 'MQTTBox');
  assert.equal(await currentPage.evaluate(() => typeof require), 'function');
  assert.equal(await currentPage.evaluate(appPath =>
    require(appPath + '/build/utils/CommonConstants.js').default.APP_VERSION, info.appPath), expectedVersion,
  'the renderer must display the same current version as the executable');
  return {...info, buildDirectory: path.join(info.appPath, 'build')};
}

async function screenshot(prefix, name) {
  const filename = `${prefix}-${name}.png`;
  await currentPage.screenshot({path: path.join(screenshots, filename), fullPage: true, timeout: 10000});
  return filename;
}

async function verifyInlineScriptPolicy() {
  const injected = await currentPage.evaluate(() => {
    delete window.__mqttboxInjected;
    const script = document.createElement('script');
    script.textContent = 'window.__mqttboxInjected = true;';
    document.documentElement.appendChild(script);
    const result = window.__mqttboxInjected;
    script.remove();
    delete window.__mqttboxInjected;
    return result;
  });
  assert.equal(injected, undefined, 'the page CSP must block a dynamically injected inline script');
  console.log('PASS: the real page CSP blocks dynamically injected inline JavaScript.');
}

async function verifyVendorRuntime() {
  const vendor = await currentPage.evaluate(() => ({
    jquery: window.jQuery.fn.jquery,
    collapse: window.jQuery.fn.collapse.Constructor.VERSION,
    dropdown: window.jQuery.fn.dropdown.Constructor.VERSION,
    transition: typeof window.jQuery.fn.emulateTransitionEnd,
    tooltip: typeof window.jQuery.fn.tooltip,
    popover: typeof window.jQuery.fn.popover,
    button: typeof window.jQuery.fn.button
  }));
  assert.deepEqual(vendor, {jquery: '3.7.1', collapse: '3.4.1', dropdown: '3.4.1',
    transition: 'function', tooltip: 'undefined', popover: 'undefined', button: 'undefined'});
  console.log('PASS: current jQuery and the three required Bootstrap modules loaded; unused plugins are absent.');
}

async function verifyMenuDropdown() {
  const menu = currentPage.locator('#app .dropdown-menu').first();
  const toggle = currentPage.locator('#app button.dropdown-toggle').first();
  assert.equal(await menu.isVisible(), false);
  await toggle.click();
  await menu.waitFor({state: 'visible'});
  for (const route of ['mqttclientslist', 'mqttloadlist', 'aboutapp']) {
    await menu.locator(`a[href="#/${route}"]`).waitFor({state: 'visible'});
  }
  await toggle.click();
  await menu.waitFor({state: 'hidden'});
  console.log('PASS: original menu dropdown opens and closes with real clicks.');
}

async function verifyReceivedMessageCollapse(payload) {
  const heading = currentPage.locator('.panel-heading').filter({hasText: payload}).first();
  const panel = heading.locator('..');
  const body = panel.locator('.panel-collapse');
  await body.waitFor({state: 'visible'});
  await heading.click();
  await body.waitFor({state: 'hidden'});
  assert.equal(await body.evaluate(element => element.classList.contains('collapsing')), false);
  await heading.click();
  await until(async () => await body.isVisible() && await body.evaluate(element =>
    element.classList.contains('collapse') && element.classList.contains('in') &&
    !element.classList.contains('collapsing')),
  'received-message panel finishes its expand animation', 5000);
  console.log('PASS: received QoS 2 message details collapse and expand after animation.');
}

async function verifyConnectionWorker(info, id) {
  const worker = await application.evaluate(({app}, mcsId) => {
    // Modern Electron's inspector context has no global require. Load through
    // the real CommonJS entry module whose production services are cached.
    const requireFromMain = process.mainModule.require.bind(process.mainModule);
    const path = requireFromMain('node:path');
    const service = requireFromMain(path.join(app.getAppPath(), 'build/platform/PlatformMqttClientService.js')).default;
    const child = service.mqttClientConnectionWorkers[mcsId];
    return child && {pid: child.pid, connected: child.connected, spawnargs: child.spawnargs};
  }, id);
  assert.ok(worker && worker.pid > 0 && worker.connected, 'main process created a live MQTT worker');
  assert.ok(worker.spawnargs.some(argument =>
    argument === path.join(info.buildDirectory, 'platform/PlatformMqttClientWorkerService.js')),
  `worker must come from this application's build directory: ${JSON.stringify(worker.spawnargs)}`);
  childPids.add(worker.pid);
  console.log(`MQTT worker ${worker.pid}: ${path.join(info.buildDirectory, 'platform/PlatformMqttClientWorkerService.js')}`);
  return worker.pid;
}

async function createClient(info, name, clientId, topic, payload) {
  const page = currentPage;
  await page.getByRole('button', {name: 'Create MQTT Client', exact: true}).first().click();
  await page.locator('input[name="mqttClientName"]').fill(name);
  await page.locator('input[name="mqttClientId"]').fill(clientId);
  await page.locator('input[name="timestampClientId"]').uncheck();
  await page.locator('select[name="protocol"]').selectOption('mqtt');
  await page.locator('input[name="host"]').fill(`127.0.0.1:${fixture.port}`);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  // Bootstrap's :before icon glyph participates in the accessible name.
  await page.locator('button.btn-success').filter({hasText: /^\s*Connected\s*$/}).waitFor();
  const settings = await page.evaluate(({buildDirectory, clientName}) => {
    return require(buildDirectory + '/services/MqttClientService.js').default
      .getAllMqttClientSettings().find(item => item.mqttClientName === clientName);
  }, {buildDirectory: info.buildDirectory, clientName: name});
  assert.ok(settings && settings.mcsId, 'UI Save created the MQTT profile');
  await verifyConnectionWorker(info, settings.mcsId);
  await until(() => fixture.connections.includes(clientId), 'broker connection from Electron worker');

  const subscriber = page.locator('.thumbnail').filter({
    has: page.getByRole('button', {name: 'Subscribe', exact: true})
  });
  await subscriber.locator('input[name="topic"]').fill(topic);
  await subscriber.locator('select[name="qos"]').selectOption('2');
  await subscriber.getByRole('button', {name: 'Subscribe', exact: true}).click();
  await until(() => fixture.subscriptions.some(item => item.clientId === clientId &&
    item.topics.some(subscription => subscription.topic === topic && subscription.qos === 2)),
  'broker accepted the UI QoS 2 subscription');

  const publisher = page.locator('.thumbnail').filter({
    has: page.getByRole('button', {name: 'Publish', exact: true})
  });
  await publisher.locator('input[name="topic"]').fill(topic);
  await publisher.locator('select[name="qos"]').selectOption('2');
  await publisher.locator('textarea[name="payload"]').fill(payload);
  await publisher.getByRole('button', {name: 'Publish', exact: true}).click();
  await until(() => fixture.publications.some(item => item.clientId === clientId &&
    item.topic === topic && item.qos === 2 && item.payload === payload),
  'broker received the UI QoS 2 publication');
  await page.waitForFunction(({buildDirectory, id, message}) => {
    const service = require(buildDirectory + '/services/MqttClientService.js').default;
    const profile = service.getMqttClientSettingsByMcsId(id);
    const received = service.getSubscribedData(id, profile.subscribeSettings[0].subId);
    const published = service.getAllPublishedMessages(id, profile.publishSettings[0].pubId);
    return received && received.receivedMessages.some(item =>
      item.message === message && item.packet.qos === 2) &&
      published.some(item => item.payload === message && Number(item.qos) === 2 &&
        item.qosResponseReceivedTime >= item.publishedTime);
  }, {buildDirectory: info.buildDirectory, id: settings.mcsId, message: payload});
  await page.getByText(payload, {exact: true}).first().waitFor();
  await verifyReceivedMessageCollapse(payload);

  // Wait for the real asynchronous IndexedDB write before stopping Electron.
  await page.waitForFunction(async ({buildDirectory, id, expectedTopic, expectedPayload}) => {
    const db = require(buildDirectory + '/services/MqttClientDbService.js').default.db;
    const profile = await db.getItem(id);
    return profile && profile.publishSettings[0].topic === expectedTopic &&
      profile.publishSettings[0].payload === expectedPayload &&
      Number(profile.publishSettings[0].qos) === 2 &&
      profile.subscribeSettings[0].topic === expectedTopic &&
      Number(profile.subscribeSettings[0].qos) === 2;
  }, {buildDirectory: info.buildDirectory, id: settings.mcsId,
    expectedTopic: topic, expectedPayload: payload});
  return settings.mcsId;
}

async function verifySingleMessageGraph(info, prefix) {
  const page = currentPage;
  await page.evaluate(() => { location.hash = '#/mqttloadlist'; });
  await page.getByRole('button', {name: 'Create MQTT Load', exact: true}).first().click();
  const name = `Single-message graph ${process.pid}`;
  await page.locator('input[name="mqttClientName"]').fill(name);
  await page.locator('select[name="protocol"]').selectOption('mqtt');
  await page.locator('input[name="host"]').fill(`127.0.0.1:${fixture.port}`);
  await page.locator('input[name="msgCount"]').fill('1');
  await page.locator('input[name="runTime"]').fill('1');
  await page.locator('input[name="timeOut"]').fill('10');
  await page.locator('input[name="instanceCount"]').fill('1');
  await page.locator('input[name="topic"]').fill(`mqttbox/smoke/${process.pid}/load`);
  await page.locator('select[name="qos"]').selectOption('2');
  await page.locator('textarea').fill('one-message graph regression');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await page.locator('button[title="Start Load Test"]').first().click();
  await page.getByText('Load test completed successfully', {exact: true}).waitFor();
  const loadId = await page.evaluate(({buildDirectory, loadName}) => {
    return require(buildDirectory + '/services/MqttLoadService.js').default
      .getAllMqttLoadSettings().find(item => item.mqttClientName === loadName).mcsId;
  }, {buildDirectory: info.buildDirectory, loadName: name});
  await page.waitForFunction(async ({buildDirectory, id}) => {
    const service = require(buildDirectory + '/services/MqttLoadService.js').default;
    const settings = service.getMqttLoadSettingsByMcsId(id);
    const instance = Object.values(settings.instances)[0];
    if (!instance || instance.overallStatus !== 'Done' || instance.qosReceivedMessCount !== 1) return false;
    const archive = await require(buildDirectory + '/services/MqttLoadDbService.js').default
      .loadInstanceDataDb.getItem(instance.iId);
    return archive && archive.receivedMessages.length === 1;
  }, {buildDirectory: info.buildDirectory, id: loadId});

  // Verify the actual render function before exercising the regression. With
  // one archived message minTime === maxTime, so an unclamped step is zero.
  const graphFunction = await page.evaluate(buildDirectory => {
    const Graph = require(buildDirectory + '/components/mqttLoad/MqttLoadTestGraph.js').default;
    return {name: Graph.name, render: Function.prototype.toString.call(Graph.prototype.render)};
  }, info.buildDirectory);
  assert.equal(graphFunction.name, 'MqttLoadTestGraph');
  assert.match(graphFunction.render, /timeSample/);
  await page.locator('button[title="View Data"]').click();
  await page.getByText('one-message graph regression', {exact: true}).waitFor();
  await screenshot(prefix, '03-load-data');
  if (process.env.MQTTBOX_SKIP_GRAPH === '1') {
    console.log('SKIP: graph render (MQTTBOX_SKIP_GRAPH=1); load worker and data table still verified.');
    return;
  }
  await page.evaluate(id => { location.hash = '#/mqttloaddashboard/' + id; }, loadId);
  await page.locator('button[title="View Graph"]').click();
  await deadline(page.locator('.recharts-wrapper > svg.recharts-surface').waitFor(), 12000,
    'single-message graph must render without a zero-step infinite loop');
  await screenshot(prefix, '04-single-message-graph');
}

async function main() {
  fixture = await startFixture();
  await fs.mkdir(screenshots, {recursive: true});
  await fs.rm(path.join(screenshots, 'electron-smoke-failure.png'), {force: true});
  const info = await launch();
  const prefix = `${info.packaged ? 'packaged' : 'development'}-${info.arch}`;
  console.log(`Electron ${info.electron} ${info.arch}; packaged=${info.packaged}`);
  console.log(`MQTTBox release: ${info.version}`);
  console.log(`Application: ${info.appPath}`);
  await verifyInlineScriptPolicy();
  if (process.env.MQTTBOX_CSP_PROBE_ONLY === '1') return;
  await verifyVendorRuntime();
  await screenshot(prefix, '01-mqtt-clients');
  await verifyMenuDropdown();
  const name = `Electron smoke ${process.pid}`;
  const clientId = `mqttbox_electron_smoke_${process.pid}`;
  const topic = `mqttbox/smoke/${process.pid}/qos2`;
  const payload = `QoS 2 round trip ${process.pid}`;
  const id = await createClient(info, name, clientId, topic, payload);
  await screenshot(prefix, '02-qos2-roundtrip');
  await verifySingleMessageGraph(info, prefix);
  await closeElectron(application);
  application = null;

  const restarted = await launch();
  await currentPage.getByText(name, {exact: true}).first().waitFor();
  const persisted = await currentPage.evaluate(({buildDirectory, mcsId}) => {
    return require(buildDirectory + '/services/MqttClientService.js').default
      .getMqttClientSettingsByMcsId(mcsId);
  }, {buildDirectory: restarted.buildDirectory, mcsId: id});
  assert.ok(persisted, 'profile survived a complete Electron process restart');
  assert.equal(persisted.host, `127.0.0.1:${fixture.port}`);
  assert.equal(persisted.publishSettings[0].payload, payload);
  assert.equal(persisted.subscribeSettings[0].topic, topic);
  assert.equal(persisted.autoConnectOnAppLaunch, true);
  await currentPage.waitForFunction(({buildDirectory, mcsId}) => {
    return require(buildDirectory + '/services/MqttClientService.js').default
      .getMqttClientStateByMcsId(mcsId) === 'CONNECTED';
  }, {buildDirectory: restarted.buildDirectory, mcsId: id});
  await verifyConnectionWorker(restarted, id);
  await screenshot(prefix, '05-persisted-profile');
  assert.deepEqual(pageErrors, [], 'renderer has no uncaught JavaScript exceptions');
  assert.deepEqual(fixture.brokerErrors, [], 'broker has no client protocol errors');
  await until(() => fixture.apiRequests.length >= 2,
    'both app launches check GitHub releases through the installed local route');
  assert.ok(fixture.apiRequests.every(request => request.method === 'GET'));
  assert.deepEqual(fixture.blockedRequests, [], 'the app must not request unrelated remote URLs');
  assert.equal(fixture.proxyRequests.some(url => url.includes('workswithweb.com')), false,
    'the app must not contact the legacy telemetry endpoint');
  console.log(`GitHub release checks handled by local routes: ${fixture.apiRequests.length}; packaged startup CONNECTs blocked locally: ${fixture.startupProxyBlocks.length}`);
  console.log('PASS: original UI, profile creation, QoS 2 publish/subscribe, main worker paths,');
  console.log(`      one-message load/data${process.env.MQTTBOX_SKIP_GRAPH === '1' ? '' : '/graph'}, restart persistence and automatic reconnect.`);
  console.log(`Screenshots: ${screenshots}/${prefix}-*.png`);
}

const watchdog = setTimeout(() => {
  console.error('FAIL: Electron smoke exceeded its 120-second process deadline');
  for (const pid of childPids) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
  if (application) application.process().kill('SIGKILL');
  process.exit(1);
}, 120000);

main().catch(async error => {
  console.error(error.stack || error);
  if (pageErrors.length) console.error('Renderer errors:', pageErrors);
  if (fixture) console.error('Broker observations:', JSON.stringify({
    connections: fixture.connections,
    subscriptions: fixture.subscriptions,
    publications: fixture.publications,
    errors: fixture.brokerErrors,
    apiRequests: fixture.apiRequests,
    blockedRequests: fixture.blockedRequests
  }));
  if (currentPage && !currentPage.isClosed()) {
    try {
      console.error('UI at failure:', await deadline(currentPage.locator('body').innerText(), 3000, 'failure text'));
      await currentPage.screenshot({path: path.join(screenshots, 'electron-smoke-failure.png'), timeout: 3000});
    } catch (_) {}
  }
  process.exitCode = 1;
}).finally(async () => {
  try {
    await closeElectron(application);
    for (const pid of childPids) {
      try {
        process.kill(pid, 0);
        process.kill(pid, 'SIGKILL');
        console.error(`FAIL: orphaned MQTT worker ${pid} required forced cleanup`);
        process.exitCode = 1;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    if (fixture) await deadline(fixture.close(), 5000, 'local fixture shutdown');
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
  }
});
