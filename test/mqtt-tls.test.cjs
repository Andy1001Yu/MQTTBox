'use strict';

const assert = require('node:assert/strict');
const tls = require('node:tls');
const { test, before, after } = require('node:test');
const { CLIENT, startBroker, clientSettings, observeWorker, clientEvent,
  connectWorker, subscribeWorker, makeCertificates, waitFor } = require('./helpers/mqtt-harness.cjs');

let certificates;
before(() => {
  certificates = makeCertificates();
  console.log('TLS fixture diagnostics:', JSON.stringify(certificates.diagnostics));
});
after(() => { if (certificates) certificates.remove(); });

async function nativeTlsControl(server, overrides, host) {
  return new Promise(resolve => {
    const socket = tls.connect({host, port: server.port, ca: overrides.caFile,
      cert: overrides.clientCertificateFile, key: overrides.clientKeyFile,
      passphrase: overrides.clientKeyPassphrase, rejectUnauthorized: true,
      ...(overrides.sslTlsVersion && overrides.sslTlsVersion !== 'auto' ?
        {secureProtocol: overrides.sslTlsVersion} : {})});
    const timer = setTimeout(() => finish({outcome: 'timeout'}), 2500);
    function finish(result) {
      clearTimeout(timer);
      socket.destroy();
      resolve({host, ...result});
    }
    socket.once('secureConnect', () => finish({outcome: 'connected', authorized: socket.authorized,
      remoteAddress: socket.remoteAddress, protocol: socket.getProtocol(),
      peerFingerprint256: socket.getPeerCertificate().fingerprint256}));
    socket.once('error', error => finish({outcome: 'error', code: error.code, message: error.message}));
  });
}

async function roundTrip(t, server, overrides = {}) {
  const { worker } = observeWorker(t);
  try {
    await connectWorker(worker, clientSettings(server, overrides));
  } catch (error) {
    const nativeControls = server.protocol === 'mqtts' || server.protocol === 'wss' ?
      await Promise.all(['localhost', '127.0.0.1'].map(host => nativeTlsControl(server, overrides, host))) : [];
    throw new Error(`${error.message}; fixture certificates: ${JSON.stringify(certificates.diagnostics)}; ` +
      `native TLS controls: ${JSON.stringify(nativeControls)}; broker TLS errors: ${JSON.stringify(server.tlsErrors)}`,
    {cause: error});
  }
  await subscribeWorker(worker, 'secure/roundtrip', '1');
  const received = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED);
  const published = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_PUBLISHED_MESSAGE);
  worker.processAction({ actionType: CLIENT.ACTION_PUBLISH_MESSAGE,
    data: { topic: 'secure/roundtrip', payload: 'encrypted payload', qos: '1', retain: false, pubId: 'tls-publisher' } });
  const [message] = await Promise.all([received, published]);
  assert.equal(message.message, 'encrypted payload');
  return worker;
}

test('TLS custom CA validates the local broker certificate', { timeout: 15000 }, async t => {
  const server = await startBroker(t, { protocol: 'mqtts', tls: certificates.server });
  const worker = await roundTrip(t, server, { certificateType: 'cc', caFile: certificates.ca });
  assert.equal(worker.client.stream.authorized, true);
  assert.equal(server.acceptedTLS.length, 1);
});

test('TLS client-certificate mode authenticates the supplied key and certificate', { timeout: 15000 }, async t => {
  const server = await startBroker(t, { protocol: 'mqtts', tls: {
    ...certificates.server, ca: certificates.ca, requestCert: true, rejectUnauthorized: true
  } });
  await roundTrip(t, server, { certificateType: 'ssc', caFile: certificates.ca,
    clientCertificateFile: certificates.clientCert, clientKeyFile: certificates.clientKey,
    clientKeyPassphrase: '', sslTlsVersion: 'TLSv1_2_method' });
  assert.equal(server.acceptedTLS[0].authorized, true);
  assert.equal(server.acceptedTLS[0].peer.subject.CN, 'mqttbox-client');
  assert.equal(server.acceptedTLS[0].protocol, 'TLSv1.2');
});

for (const protocol of ['mqtts', 'wss']) {
  test(`CA-signed mode rejects an untrusted server certificate over ${protocol}`, { timeout: 15000 }, async t => {
    const server = await startBroker(t, { protocol, tls: certificates.self });
    const { worker, events } = observeWorker(t);
    const outcome = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_CONN_STATE_CHANGED);
    worker.processAction({ actionType: CLIENT.ACTION_MQTT_CLIENT_CONNECT,
      data: clientSettings(server, { certificateType: 'cssc' }) });
    // mqtt@2.18 forwards TLS errors for MQTTS, while websocket-stream can
    // expose the certificate failure only on its underlying WebSocket.
    const errorSource = protocol === 'wss' ? worker.client.stream.socket : worker.client;
    assert.ok(errorSource && typeof errorSource.on === 'function');
    const certificateError = waitFor(errorSource, 'error');
    const [state, error] = await Promise.all([outcome, certificateError]);
    assert.equal(state.connState, CLIENT.CONNECTION_STATE_ERROR,
      'the CA-signed setting must reject an untrusted peer instead of establishing a session');
    assert.match(error.message, /self.signed|certificate|verify/i);
    assert.equal(events.some(event => event.data.connState === CLIENT.CONNECTION_STATE_CONNECTED), false);
    assert.equal(server.acceptedTLS.length, 0);
    assert.equal(server.packets.length, 0);
  });
}

test('custom CA mode rejects a broker signed by a different authority', { timeout: 15000 }, async t => {
  const server = await startBroker(t, { protocol: 'mqtts', tls: certificates.self });
  const { worker, events } = observeWorker(t);
  const rejected = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_CONN_STATE_CHANGED,
    data => data.connState === CLIENT.CONNECTION_STATE_ERROR);
  worker.processAction({ actionType: CLIENT.ACTION_MQTT_CLIENT_CONNECT,
    data: clientSettings(server, { certificateType: 'cc', caFile: certificates.ca }) });
  const error = waitFor(worker.client, 'error');
  await rejected;
  assert.match((await error).message, /self.signed|certificate|verify/i);
  assert.equal(events.some(event => event.data.connState === CLIENT.CONNECTION_STATE_CONNECTED), false);
  assert.equal(server.acceptedTLS.length, 0);
  assert.equal(server.packets.length, 0);
});

test('WebSocket transport exchanges MQTT messages on a URL path', { timeout: 15000 }, async t => {
  const server = await startBroker(t, { protocol: 'ws' });
  await roundTrip(t, server);
});

test('secure WebSocket transport honors the configured CA', { timeout: 15000 }, async t => {
  const server = await startBroker(t, { protocol: 'wss', tls: certificates.server });
  await roundTrip(t, server, { certificateType: 'cc', caFile: certificates.ca });
  assert.equal(server.acceptedTLS.length, 1);
});
