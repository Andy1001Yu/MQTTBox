'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CLIENT, LOAD, bounded, waitFor, startBroker, clientSettings, observeWorker,
  clientEvent, connectWorker, subscribeWorker, rawClient, publish,
  forkWorker } = require('./helpers/mqtt-harness.cjs');

async function workerRoundTrip(worker, topic, payload, qos = '1') {
  await subscribeWorker(worker, topic, qos);
  const received = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED,
    data => data.message === payload);
  const confirmed = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_PUBLISHED_MESSAGE,
    data => data.payload === payload);
  worker.processAction({ actionType: CLIENT.ACTION_PUBLISH_MESSAGE,
    data: { topic, payload, qos, retain: false, pubId: 'extended-publisher' } });
  const [message] = await Promise.all([received, confirmed]);
  assert.equal(message.packet.topic, topic);
  assert.equal(message.packet.qos, Number(qos));
  return message;
}

test('ten concurrent child load workers publish and archive 500 QoS 1 messages each', { timeout: 25000 }, async t => {
  const server = await startBroker(t);
  const instanceCount = 10;
  const messagesPerInstance = 500;
  const pendingConnections = [];
  const active = new Set();
  let maxConcurrent = 0;
  // Release all real CONNECT packets together so the ten load intervals overlap,
  // independent of process startup scheduling on the test machine.
  server.broker.preConnect = (client, packet, callback) => {
    pendingConnections.push(callback);
    if (pendingConnections.length === instanceCount) {
      for (const complete of pendingConnections) complete(null, true);
    }
  };
  server.broker.on('clientReady', client => {
    active.add(client.id);
    maxConcurrent = Math.max(maxConcurrent, active.size);
  });
  server.broker.on('clientDisconnect', client => active.delete(client.id));
  const services = Array.from({ length: instanceCount }, () => forkWorker(t, 'PlatformMqttLoadWorkerService'));
  const settings = services.map((_, index) => clientSettings(server, {
    loadTestType: 'publishing', msgCount: messagesPerInstance, runTime: 1.5, timeOut: 10,
    connectTimeout: 5000, topic: `concurrent/instance-${index}`, qos: '1',
    payload: [`instance-${index}:alpha`, `instance-${index}:中文`]
  }));
  const completed = services.map(service => service.event(LOAD.EVENT_MQTT_LOAD_TEST_ENDED, () => true, 15000));
  const receivedAll = waitFor(server.broker, 'publish', () => server.packets.length === 5000, 15000)
    .catch(error => { throw new Error(`${error.message}: broker received ${server.packets.length}/5000 messages`); });
  const allResults = Promise.all([...completed, receivedAll]);
  for (let index = 0; index < services.length; index++) {
    services[index].child.send({ actionType: LOAD.ACTION_START_MQTT_LOAD_TEST,
      data: { loadObj: settings[index], iId: `concurrent-${index}`, inum: index + 1 } });
  }
  const results = await allResults;
  const exits = await Promise.all(services.map(service => service.exited));
  assert.equal(maxConcurrent, 10, 'all ten broker connections must overlap');
  assert.equal(server.packets.length, 5000);
  for (let index = 0; index < instanceCount; index++) {
    const result = results[index];
    const brokerPackets = server.packets.filter(packet => packet.clientId === settings[index].mqttClientId);
    const expected = Array.from({ length: 500 }, (_, sequence) =>
      sequence % 2 === 0 ? `instance-${index}:alpha` : `instance-${index}:中文`);
    assert.equal(exits[index].code, 0, services[index].output());
    assert.equal(result.mcsId, settings[index].mcsId);
    assert.equal(result.iId, `concurrent-${index}`);
    assert.equal(result.messCount, 500);
    assert.equal(result.qosReceivedMessCount, 500);
    assert.equal(result.archiveData.receivedMessages.length, 500);
    assert.deepEqual(result.archiveData.metaData, { iId: `concurrent-${index}`, inum: index + 1 });
    assert.equal(brokerPackets.length, 500);
    assert.ok(brokerPackets.every(packet => packet.topic === `concurrent/instance-${index}` && packet.qos === 1));
    assert.deepEqual(brokerPackets.map(packet => packet.payload), expected);
    assert.deepEqual(result.archiveData.receivedMessages.map(message => message.data.payload), expected);
    assert.ok(result.archiveData.receivedMessages.every(message =>
      message.data.qos === 1 && message.data.topic === `concurrent/instance-${index}` && message.data.inum === index + 1));
    assert.equal(services[index].events.filter(event => event.event === LOAD.EVENT_MQTT_LOAD_TEST_ENDED).length, 1);
    assert.ok(services[index].events.some(event => event.event === LOAD.EVENT_MQTT_LOAD_STATUS_MESSAGE &&
      event.data.statusObj.message === LOAD.LOAD_COMPLETED && event.data.statusObj.status === LOAD.STATE_SUCCESS));
  }
});

test('username and password authenticate the connection worker before message delivery', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  server.broker.authenticate = (client, username, password, callback) => {
    callback(null, username === 'mqttbox-user' && password && password.toString() === 'local-test-password');
  };
  const { worker } = observeWorker(t);
  await connectWorker(worker, clientSettings(server, { username: 'mqttbox-user', password: 'local-test-password' }));
  const message = await workerRoundTrip(worker, 'authenticated/messages', 'authenticated delivery');
  assert.equal(message.message, 'authenticated delivery');
});

test('an incorrect broker password emits a connection error without authorizing a session', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  server.broker.authenticate = (client, username, password, callback) => {
    callback(null, username === 'mqttbox-user' && password && password.toString() === 'local-test-password');
  };
  const { worker, events } = observeWorker(t);
  const rejected = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_CONN_STATE_CHANGED,
    data => data.connState === CLIENT.CONNECTION_STATE_ERROR);
  worker.processAction({ actionType: CLIENT.ACTION_MQTT_CLIENT_CONNECT,
    data: clientSettings(server, { username: 'mqttbox-user', password: 'incorrect-password' }) });
  const connack = waitFor(worker.client, 'packetreceive', packet => packet.cmd === 'connack');
  const [, response] = await Promise.all([rejected, connack]);
  assert.equal(response.returnCode, 5);
  assert.equal(events.some(event => event.data.connState === CLIENT.CONNECTION_STATE_CONNECTED), false);
  assert.equal(Object.keys(server.broker.clients).length, 0);
});

test('MQTT 3.1 connects with MQIsdp and exchanges QoS 2 messages', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  let protocol;
  server.broker.preConnect = (client, packet, callback) => {
    protocol = { id: packet.protocolId, version: packet.protocolVersion };
    callback(null, true);
  };
  const { worker } = observeWorker(t);
  await connectWorker(worker, clientSettings(server, {
    protocolId: 'MQIsdp', protocolVersion: 3, mqttClientId: 'mqttbox-v31'
  }));
  assert.deepEqual(protocol, { id: 'MQIsdp', version: 3 });
  assert.equal((await workerRoundTrip(worker, 'mqtt31/messages', 'MQTT 3.1 payload', '2')).message, 'MQTT 3.1 payload');
});

test('abrupt worker process termination publishes and retains its configured last will', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  const watcher = await rawClient(t, server);
  await bounded(new Promise((resolve, reject) => {
    watcher.subscribe('will/#', { qos: 1 }, error => error ? reject(error) : resolve());
  }), 'subscribe will observer');
  const service = forkWorker(t, 'PlatformMqttClientWorkerService');
  service.child.send({ actionType: CLIENT.ACTION_MQTT_CLIENT_CONNECT,
    data: clientSettings(server, { willTopic: 'will/status', willPayload: 'offline unexpectedly', willQos: 1, willRetain: true }) });
  await service.event(CLIENT.EVENT_MQTT_CLIENT_CONN_STATE_CHANGED,
    data => data.connState === CLIENT.CONNECTION_STATE_CONNECTED);
  const will = waitFor(watcher, 'message', topic => topic === 'will/status');
  service.child.kill('SIGKILL');
  const [[topic, payload, packet], exit] = await Promise.all([will, service.exited]);
  assert.equal(exit.signal, 'SIGKILL');
  assert.equal(topic, 'will/status');
  assert.equal(payload.toString(), 'offline unexpectedly');
  assert.equal(packet.qos, 1);
  const { worker } = observeWorker(t);
  await connectWorker(worker, clientSettings(server));
  const retained = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED);
  await subscribeWorker(worker, 'will/#', '1');
  const message = await retained;
  assert.equal(message.message, 'offline unexpectedly');
  assert.equal(message.packet.retain, true);
  assert.equal(message.packet.topic, 'will/status');
});

test('the connection worker reconnects and restores wildcard delivery after socket loss', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  const { worker, events } = observeWorker(t);
  const settings = clientSettings(server, { reconnectPeriod: 50 });
  await connectWorker(worker, settings);
  await subscribeWorker(worker, 'reconnect/#', '1');
  const publisher = await rawClient(t, server);
  const first = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED,
    data => data.message === 'before reconnect');
  await publish(publisher, 'reconnect/data', 'before reconnect', { qos: 1 });
  await first;
  const connectionError = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_CONN_STATE_CHANGED,
    data => data.connState === CLIENT.CONNECTION_STATE_ERROR);
  const reconnected = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_CONN_STATE_CHANGED,
    data => data.connState === CLIENT.CONNECTION_STATE_CONNECTED);
  const resubscribed = waitFor(server.broker, 'subscribe', (subscriptions, client) =>
    client.id === settings.mqttClientId && subscriptions.some(subscription => subscription.topic === 'reconnect/#'));
  worker.client.stream.destroy();
  await Promise.all([connectionError, reconnected, resubscribed]);
  const restored = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED,
    data => data.message === 'after reconnect');
  await publish(publisher, 'reconnect/data', 'after reconnect', { qos: 1 });
  const message = await restored;
  assert.equal(message.topic, 'reconnect/#');
  assert.equal(message.packet.qos, 1);
  assert.equal(events.filter(event => event.event === CLIENT.EVENT_MQTT_CLIENT_CONN_STATE_CHANGED &&
    event.data.connState === CLIENT.CONNECTION_STATE_CONNECTED).length, 2);
});
