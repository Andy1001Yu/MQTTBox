'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { execFileSync, fork } = require('node:child_process');
const { EventEmitter } = require('node:events');
const mqtt = require('mqtt');
const aedes = require('aedes');

const ROOT = path.resolve(__dirname, '../..');
const BUILD = process.env.MQTTBOX_TEST_BUILD_DIR || path.join(ROOT, 'build');
const ClientWorker = require(path.join(BUILD, 'workers/MqttClientConnectionWorker')).default;
const LoadWorker = require(path.join(BUILD, 'workers/MqttLoadTestWorker')).default;
const CLIENT = require(path.join(BUILD, 'utils/MqttClientConstants'));
const LOAD = require(path.join(BUILD, 'utils/MqttLoadConstants'));

function waitFor(emitter, event, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${event}`)), timeout);
    const listener = (...args) => {
      try {
        if (predicate(...args)) finish(null, args.length === 1 ? args[0] : args);
      } catch (error) {
        finish(error);
      }
    };
    function finish(error, value) {
      clearTimeout(timer);
      emitter.removeListener(event, listener);
      if (error) reject(error);
      else resolve(value);
    }
    emitter.on(event, listener);
  });
}

async function bounded(promise, description, timeout = 5000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), timeout);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startBroker(t, options = {}) {
  const broker = aedes();
  const packets = [];
  const sockets = new Set();
  const acceptedTLS = [];
  const tlsErrors = [];
  broker.on('publish', (packet, client) => {
    if (client) packets.push({ clientId: client.id, topic: packet.topic,
      payload: packet.payload.toString(), qos: packet.qos, retain: packet.retain });
  });
  // Authentication rejection is asserted by the tests, not thrown by this fixture.
  broker.on('clientError', () => {});
  broker.on('connectionError', () => {});
  let server;
  let websocketServer;
  const protocol = options.protocol || 'mqtt';
  if (protocol === 'ws' || protocol === 'wss') {
    const websocketStream = require('websocket-stream');
    server = protocol === 'wss' ? https.createServer(options.tls) : http.createServer();
    websocketServer = websocketStream.createServer({ server }, broker.handle);
    websocketServer.on('error', () => {});
  } else {
    server = protocol === 'mqtts' ? tls.createServer(options.tls, broker.handle) : net.createServer(broker.handle);
  }
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('secureConnection', socket => {
    acceptedTLS.push({ authorized: socket.authorized, peer: socket.getPeerCertificate(), protocol: socket.getProtocol() });
  });
  server.on('tlsClientError', error => {
    tlsErrors.push({code: error.code, message: error.message});
  });
  t.after(async () => {
    if (websocketServer) {
      for (const client of websocketServer.clients) client.terminate();
      websocketServer.close();
    }
    for (const socket of sockets) socket.destroy();
    await bounded(new Promise(resolve => server.close(resolve)), 'close broker listener');
    await bounded(new Promise(resolve => broker.close(resolve)), 'close broker');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const port = server.address().port;
  return { broker, packets, acceptedTLS, tlsErrors, protocol, port,
    host: `${protocol === 'mqtts' || protocol === 'wss' ? 'localhost' : '127.0.0.1'}:${port}${protocol === 'ws' || protocol === 'wss' ? '/mqtt' : ''}` };
}

let id = 0;
function clientSettings(server, overrides = {}) {
  const suffix = ++id;
  return {
    mcsId: `settings-${process.pid}-${suffix}`,
    mqttClientId: `mqttbox-test-${process.pid}-${suffix}`,
    protocol: server.protocol,
    host: server.host,
    protocolId: 'MQTT', protocolVersion: 4,
    keepalive: 10, reschedulePings: true,
    timestampClientId: false, clean: true,
    reconnectPeriod: 0, connectTimeout: 1500,
    queueQoSZero: true, username: '', password: '',
    sslTlsVersion: 'auto', certificateType: 'cc',
    ...overrides
  };
}

function observeWorker(t, Worker = ClientWorker) {
  const worker = new Worker();
  const events = [];
  worker.addChangeListener(event => events.push(event));
  t.after(async () => {
    clearInterval(worker.publishTimeKeeper);
    clearTimeout(worker.runTimeKeeper);
    if (worker.client) {
      // Test cleanup must also work when the implementation under test fails.
      worker.isDisconnecting = true;
      worker.client.options.reconnectPeriod = 0;
      await closeClient(worker.client);
    }
  });
  return { worker, events };
}

async function closeClient(client) {
  // mqtt@2.1.1 deliberately ignores a second end() callback. It also cannot
  // emit another stream close after fixture teardown already closed the broker.
  if (client.disconnecting || client.disconnected) return;
  if (!client.connected || client.stream.destroyed) {
    client.end(true);
    return;
  }
  await bounded(new Promise(resolve => client.end(true, resolve)), 'close MQTT client');
}

function clientEvent(worker, type, predicate = () => true, timeout = 5000) {
  return waitFor(worker, CLIENT.EVENT_WORKER_MQTT_CLIENT,
    event => event.event === type && predicate(event.data), timeout).then(event => event.data);
}

function loadEvent(worker, type, predicate = () => true, timeout = 5000) {
  return waitFor(worker, LOAD.EVENT_WORKER_MQTT_LOAD,
    event => event.event === type && predicate(event.data), timeout).then(event => event.data);
}

async function connectWorker(worker, settings) {
  const connected = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_CONN_STATE_CHANGED,
    data => data.connState === CLIENT.CONNECTION_STATE_CONNECTED);
  worker.processAction({ actionType: CLIENT.ACTION_MQTT_CLIENT_CONNECT, data: settings });
  const errors = [];
  const record = source => error => errors.push({source, code: error.code, message: error.message,
    errors: error.errors && error.errors.map(item => ({code: item.code, message: item.message}))});
  const onClientError = record('mqtt');
  const onSocketError = record('websocket');
  const socket = worker.client.stream.socket;
  worker.client.on('error', onClientError);
  if (socket) socket.on('error', onSocketError);
  try {
    await connected;
  } catch (error) {
    const stream = worker.client.stream;
    throw new Error(`${error.message}; connection diagnostics: ${JSON.stringify({
      protocol: settings.protocol, host: settings.host, errors,
      connected: worker.client.connected, destroyed: stream.destroyed,
      authorizationError: stream.authorizationError,
      remoteAddress: stream.remoteAddress, remoteFamily: stream.remoteFamily
    })}`, {cause: error});
  } finally {
    worker.client.removeListener('error', onClientError);
    if (socket) socket.removeListener('error', onSocketError);
  }
}

async function subscribeWorker(worker, topic, qos) {
  const subscribed = waitFor(worker.client, 'packetreceive', packet => packet.cmd === 'suback');
  worker.processAction({ actionType: CLIENT.ACTION_SUBSCRIBE_TO_TOPIC, data: { topic, qos } });
  const ack = await subscribed;
  assert.ok(ack.granted.every(value => value !== 128), 'broker must grant the subscription');
}

async function unsubscribeWorker(worker, topic) {
  const unsubscribed = waitFor(worker.client, 'packetreceive', packet => packet.cmd === 'unsuback');
  worker.processAction({ actionType: CLIENT.ACTION_UN_SUBSCRIBE_TO_TOPIC, data: { topic } });
  await unsubscribed;
}

async function rawClient(t, server, overrides = {}) {
  const settings = clientSettings(server);
  const client = mqtt.connect(`${server.protocol}://${server.host}`, {
    clientId: settings.mqttClientId, protocolVersion: 4, reconnectPeriod: 0, connectTimeout: 1500, ...overrides
  });
  client.on('error', () => {});
  t.after(() => closeClient(client));
  await waitFor(client, 'connect');
  return client;
}

function publish(client, topic, payload, options = {}) {
  return bounded(new Promise((resolve, reject) => {
    client.publish(topic, payload, options, error => error ? reject(error) : resolve());
  }), 'publish MQTT message');
}

function makeCertificates() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mqttbox-tls-'));
  const file = name => path.join(directory, name);
  function openssl(args) {
    execFileSync('openssl', args, { cwd: directory, stdio: 'pipe', timeout: 15000 });
  }
  try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=MQTTBox Test CA',
      '-keyout', 'ca.key', '-out', 'ca.pem', '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-addext', 'subjectKeyIdentifier=hash']);
    const identifiers = 'subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n';
    fs.writeFileSync(file('server.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' + identifiers);
    fs.writeFileSync(file('client.ext'), 'extendedKeyUsage=clientAuth\nbasicConstraints=CA:FALSE\n' + identifiers);
    for (const name of ['server', 'client']) {
      openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${name === 'server' ? 'localhost' : 'mqttbox-client'}`,
        '-keyout', `${name}.key`, '-out', `${name}.csr`]);
      openssl(['x509', '-req', '-days', '2', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
        '-extfile', `${name}.ext`, '-out', `${name}.pem`]);
    }
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost',
      '-keyout', 'self.key', '-out', 'self.pem', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
    return { directory, ca: fs.readFileSync(file('ca.pem'), 'utf8'),
      server: { key: fs.readFileSync(file('server.key')), cert: fs.readFileSync(file('server.pem')) },
      clientKey: fs.readFileSync(file('client.key'), 'utf8'), clientCert: fs.readFileSync(file('client.pem'), 'utf8'),
      self: { key: fs.readFileSync(file('self.key')), cert: fs.readFileSync(file('self.pem')) },
      remove() { fs.rmSync(directory, { recursive: true, force: true }); }
    };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function forkWorker(t, name) {
  const child = fork(path.join(BUILD, `platform/${name}.js`), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: []
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const events = [];
  const observed = new EventEmitter();
  child.on('message', message => { events.push(message); observed.emit('worker-event', message); });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await bounded(exited, 'child exit');
  });
  return { child, events, exited, output: () => output,
    event(type, predicate = () => true, timeout = 10000) {
      const match = event => event.event === type && predicate(event.data);
      const found = events.find(match);
      if (found) return Promise.resolve(found.data);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error(`Timed out waiting for child ${type}: ${output}`)), timeout);
        const onEvent = event => { if (match(event)) finish(null, event.data); };
        const onExit = (code, signal) => {
          const terminal = events.find(match);
          if (terminal) finish(null, terminal.data);
          else {
            const statuses = events.filter(event => event.data && event.data.statusObj)
              .map(event => event.data.statusObj.message);
            finish(new Error(`Worker exited before ${type} (code=${code}, signal=${signal}); statuses=${JSON.stringify(statuses)}: ${output}`));
          }
        };
        function finish(error, value) {
          clearTimeout(timer);
          observed.removeListener('worker-event', onEvent);
          child.removeListener('exit', onExit);
          if (error) reject(error);
          else resolve(value);
        }
        observed.on('worker-event', onEvent);
        child.once('exit', onExit);
        if (child.exitCode !== null || child.signalCode !== null) onExit(child.exitCode, child.signalCode);
      });
    }
  };
}

module.exports = { CLIENT, LOAD, ClientWorker, LoadWorker, bounded, waitFor, delay,
  startBroker, clientSettings, observeWorker, clientEvent, loadEvent,
  connectWorker, subscribeWorker, unsubscribeWorker, rawClient, publish, makeCertificates, forkWorker };
