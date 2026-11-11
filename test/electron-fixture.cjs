'use strict';

const assert = require('node:assert/strict');
const {realpathSync} = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Explicit executablePath launches (including packaged apps) do not load
// Playwright's default Electron bootstrap. Hold app readiness until the test
// has installed its network routes, so even the first renderer fetch is local.
if (process.versions.electron && process.type === 'browser' &&
    process.env.MQTTBOX_SMOKE_READY_GATE === '1') {
  const {app} = require('electron');
  const originallyReady = app.whenReady();
  const originalEmit = app.emit.bind(app);
  let readyArguments;
  let released = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  app.emit = (event, ...args) => {
    if (event === 'ready' && !released) {
      readyArguments = args;
      return app.listenerCount('ready') > 0;
    }
    return originalEmit(event, ...args);
  };
  app.isReady = () => released;
  app.whenReady = () => ready;
  globalThis.__playwright_run = () => {};
  globalThis.__mqttboxSmokeReleaseReady = async () => {
    await originallyReady;
    if (released) return;
    released = true;
    resolveReady();
    originalEmit('ready', ...(readyArguments || []));
  };
  const preload = process.argv.indexOf('--require');
  if (preload !== -1 && process.argv[preload + 1] === __filename) process.argv.splice(preload, 2);
}

function deadline(promise, milliseconds, description) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

async function until(predicate, description, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function trackSockets(server) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  return sockets;
}

async function startFixture() {
  const createAedes = require('aedes');
  const broker = createAedes();
  const connections = [];
  const subscriptions = [];
  const publications = [];
  const proxyRequests = [];
  const apiRequests = [];
  const blockedRequests = [];
  const startupProxyBlocks = [];
  const brokerErrors = [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mqttbox-electron-'));
  const userData = path.join(directory, 'profile');
  await fs.mkdir(userData);

  broker.on('clientReady', client => connections.push(client.id));
  broker.on('subscribe', (topics, client) => {
    if (client) subscriptions.push({clientId: client.id, topics});
  });
  broker.on('publish', (packet, client) => {
    if (client) publications.push({
      clientId: client.id,
      topic: packet.topic,
      payload: packet.payload.toString(),
      qos: packet.qos,
      retain: packet.retain
    });
  });
  broker.on('clientError', (client, error) => brokerErrors.push(`${client.id}: ${error.message}`));

  const mqttServer = net.createServer(broker.handle);
  const mqttSockets = trackSockets(mqttServer);
  const proxy = http.createServer((request, response) => {
    // Defense against accidental Node or Chromium requests escaping the
    // per-context routes. This proxy never connects to an upstream host.
    proxyRequests.push(request.url);
    request.resume();
    response.writeHead(204, {'Connection': 'close'});
    response.end();
  });
  proxy.on('connect', (request, socket) => {
    proxyRequests.push(request.url);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  const proxySockets = trackSockets(proxy);
  let port;
  let proxyPort;
  try {
    port = await listen(mqttServer);
    proxyPort = await listen(proxy);
  } catch (error) {
    for (const socket of mqttSockets) socket.destroy();
    for (const socket of proxySockets) socket.destroy();
    await Promise.all([
      new Promise(resolve => mqttServer.close(() => resolve())),
      new Promise(resolve => proxy.close(() => resolve())),
      new Promise(resolve => broker.close(resolve))
    ]);
    await fs.rm(directory, {recursive: true, force: true});
    throw error;
  }
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  return {
    directory,
    userData,
    port,
    connections,
    subscriptions,
    publications,
    proxyRequests,
    proxyUrl,
    apiRequests,
    blockedRequests,
    startupProxyBlocks,
    brokerErrors,
    env: {
      ...process.env,
      MQTTBOX_SMOKE_READY_GATE: '1',
      HTTP_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      ALL_PROXY: proxyUrl,
      all_proxy: proxyUrl,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost'
    },
    async close() {
      for (const socket of mqttSockets) socket.destroy();
      for (const socket of proxySockets) socket.destroy();
      await Promise.all([
        new Promise(resolve => mqttServer.close(resolve)),
        new Promise(resolve => proxy.close(resolve)),
        new Promise(resolve => broker.close(resolve))
      ]);
      await fs.rm(directory, {recursive: true, force: true});
    }
  };
}

async function closeElectron(application) {
  if (!application) return;
  const child = application.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    await deadline(application.close(), 5000, 'Electron shutdown');
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await deadline(new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('exit', resolve);
    }), 5000, 'Electron forced shutdown');
  }
}

function assertIsolated(actual, expected) {
  assert.equal(realpathSync(actual), realpathSync(expected),
    'Electron must use the disposable --user-data-dir before profiles are written');
}

module.exports = {assertIsolated, closeElectron, deadline, startFixture, until};
