'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { LOAD, LoadWorker, startBroker, clientSettings, observeWorker, loadEvent,
  waitFor, rawClient, publish, delay, forkWorker } = require('./helpers/mqtt-harness.cjs');

function loadSettings(server, overrides = {}) {
  return clientSettings(server, { loadTestType: 'publishing', msgCount: 32,
    runTime: 0.16, timeOut: 3, topic: 'load/messages', qos: 1,
    payload: ['alpha', '中文-beta', 'gamma'], ...overrides });
}

function startLoad(worker, settings) {
  worker.processAction({ actionType: LOAD.ACTION_START_MQTT_LOAD_TEST,
    data: { loadObj: settings, iId: 'instance-1', inum: 1 } });
}

function terminalStatus(events, message) {
  return events.filter(event => event.event === LOAD.EVENT_MQTT_LOAD_STATUS_MESSAGE)
    .find(event => event.data.statusObj.message === message);
}

for (const qos of [0, 1, 2]) {
  test(`publish load counts 32 real broker messages at numeric QoS ${qos}`, { timeout: 15000 }, async t => {
    const server = await startBroker(t);
    const { worker, events } = observeWorker(t, LoadWorker);
    const settings = loadSettings(server, { qos });
    const completed = loadEvent(worker, LOAD.EVENT_MQTT_LOAD_TEST_ENDED);
    const receivedAll = waitFor(server.broker, 'publish', () => server.packets.length === 32)
      .catch(error => { throw new Error(`${error.message}: broker received ${server.packets.length}/32 requested messages`); });
    startLoad(worker, settings);
    const [result] = await Promise.all([completed, receivedAll]);
    assert.equal(result.messCount, 32);
    assert.equal(result.qosReceivedMessCount, 32);
    assert.equal(result.archiveData.receivedMessages.length, 32);
    assert.equal(terminalStatus(events, LOAD.LOAD_COMPLETED).data.statusObj.status, LOAD.STATE_SUCCESS);
    assert.equal(server.packets.length, 32);
    const expected = Array.from({ length: 32 }, (_, index) => ['alpha', '中文-beta', 'gamma'][index % 3]);
    assert.deepEqual(server.packets.map(packet => packet.payload), expected);
    assert.ok(server.packets.every(packet => packet.qos === qos && packet.topic === 'load/messages'));
    assert.deepEqual(result.archiveData.receivedMessages.map(message => message.data.payload), expected,
      'the archive must retain each original payload after its QoS acknowledgement');
    assert.ok(result.messageEndTime >= result.messageStartTime);
    assert.ok(result.qosEndTime >= result.qosStartTime);
    await delay(40);
    assert.equal(events.filter(event => event.event === LOAD.EVENT_MQTT_LOAD_TEST_ENDED).length, 1);
  });
}

for (const qos of [0, 1, 2]) {
  test(`subscribe load records 32 delivered payloads at numeric QoS ${qos}`, { timeout: 15000 }, async t => {
    const server = await startBroker(t);
    const publisher = await rawClient(t, server);
    const { worker, events } = observeWorker(t, LoadWorker);
    const settings = loadSettings(server, { loadTestType: 'subscribing', topic: 'incoming/#', qos });
    const subscribed = loadEvent(worker, LOAD.EVENT_MQTT_LOAD_STATUS_MESSAGE,
      data => data.statusObj.message === LOAD.LOAD_MQTT_CLIENT_SUBSCRIBED);
    startLoad(worker, settings);
    await subscribed;
    const completed = loadEvent(worker, LOAD.EVENT_MQTT_LOAD_TEST_ENDED);
    for (let index = 0; index < 32; index++) {
      await publish(publisher, 'incoming/data', `message-${index}`, { qos });
    }
    const result = await completed;
    assert.equal(result.messCount, 32);
    assert.equal(result.qosReceivedMessCount, 32);
    assert.deepEqual(result.archiveData.receivedMessages.map(message => message.data.payload),
      Array.from({ length: 32 }, (_, index) => `message-${index}`));
    assert.ok(result.archiveData.receivedMessages.every(message =>
      message.data.qos === qos && message.data.topic === 'incoming/data' && message.data.inum === 1));
    assert.equal(terminalStatus(events, LOAD.LOAD_COMPLETED).data.statusObj.status, LOAD.STATE_SUCCESS);
  });
}

// Form controls supply strings. Isolate these regressions in real workers so a
// malformed packet cannot crash node:test's own process through an async event.
for (const qos of ['1', '2']) {
  test(`publish load accepts the UI's string QoS '${qos}'`, { timeout: 15000 }, async t => {
    const server = await startBroker(t);
    const service = forkWorker(t, 'PlatformMqttLoadWorkerService');
    const settings = loadSettings(server, { qos, msgCount: 12, runTime: 0.06 });
    const completed = service.event(LOAD.EVENT_MQTT_LOAD_TEST_ENDED);
    service.child.send({ actionType: LOAD.ACTION_START_MQTT_LOAD_TEST,
      data: { loadObj: settings, iId: 'string-qos-publish', inum: 1 } });
    const result = await completed;
    const exit = await service.exited;
    assert.equal(exit.code, 0, service.output());
    assert.equal(result.messCount, 12);
    assert.equal(result.qosReceivedMessCount, 12);
    assert.equal(server.packets.length, 12, 'all requested messages must actually reach the broker');
    assert.ok(server.packets.every(packet => packet.qos === Number(qos)));
    assert.equal(terminalStatus(service.events, LOAD.LOAD_COMPLETED).data.statusObj.status, LOAD.STATE_SUCCESS);
  });

  test(`subscribe load accepts the UI's string QoS '${qos}'`, { timeout: 15000 }, async t => {
    const server = await startBroker(t);
    const publisher = await rawClient(t, server);
    const service = forkWorker(t, 'PlatformMqttLoadWorkerService');
    const settings = loadSettings(server, { loadTestType: 'subscribing', qos, msgCount: 12, topic: 'string-qos/#' });
    const subscribed = service.event(LOAD.EVENT_MQTT_LOAD_STATUS_MESSAGE,
      data => data.statusObj.message === LOAD.LOAD_MQTT_CLIENT_SUBSCRIBED);
    service.child.send({ actionType: LOAD.ACTION_START_MQTT_LOAD_TEST,
      data: { loadObj: settings, iId: 'string-qos-subscribe', inum: 1 } });
    await subscribed;
    const completed = service.event(LOAD.EVENT_MQTT_LOAD_TEST_ENDED);
    for (let index = 0; index < 12; index++) {
      await publish(publisher, 'string-qos/input', `string-${index}`, { qos: Number(qos) });
    }
    const result = await completed;
    assert.equal(result.messCount, 12);
    assert.equal(result.qosReceivedMessCount, 12);
    assert.ok(result.archiveData.receivedMessages.every(message => message.data.qos === Number(qos)),
      'the broker must grant the requested QoS, not silently fall back to QoS 0');
  });
}

test('stopping a running publish load reports partial real counts and ends once', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  const { worker, events } = observeWorker(t, LoadWorker);
  const settings = loadSettings(server, { qos: 1, msgCount: 200, runTime: 5, timeOut: 8 });
  const thirdPacket = waitFor(server.broker, 'publish', () => server.packets.length >= 3);
  startLoad(worker, settings);
  await thirdPacket;
  // Wait for the in-flight acknowledgement before stopping, so the expected
  // archive and broker counts describe the same completed messages.
  if (worker.qosReceivedMessCount < 3) {
    await waitFor(worker.client, 'packetreceive', packet => packet.cmd === 'puback');
    await delay(0);
  }
  const completed = loadEvent(worker, LOAD.EVENT_MQTT_LOAD_TEST_ENDED);
  worker.processAction({ actionType: LOAD.ACTION_STOP_MQTT_LOAD_TEST });
  const result = await completed;
  assert.ok(result.messCount >= 3 && result.messCount < 200);
  assert.equal(result.messCount, server.packets.length);
  assert.equal(result.qosReceivedMessCount, result.archiveData.receivedMessages.length);
  assert.equal(terminalStatus(events, LOAD.LOAD_STOPPED).data.statusObj.status, LOAD.STATE_ERROR);
  await delay(100);
  assert.equal(server.packets.length, result.messCount, 'stop must cancel further publishing');
  assert.equal(events.filter(event => event.event === LOAD.EVENT_MQTT_LOAD_TEST_ENDED).length, 1);
});

test('an empty subscribe load times out with zero counts and no completion status', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  const { worker, events } = observeWorker(t, LoadWorker);
  const completed = loadEvent(worker, LOAD.EVENT_MQTT_LOAD_TEST_ENDED);
  startLoad(worker, loadSettings(server, { loadTestType: 'subscribing', topic: 'silent/#', timeOut: 0.15 }));
  const result = await completed;
  assert.equal(result.messCount, 0);
  assert.equal(result.qosReceivedMessCount, 0);
  assert.equal(result.archiveData, undefined);
  assert.equal(terminalStatus(events, LOAD.LOAD_TIME_OUT).data.statusObj.status, LOAD.STATE_ERROR);
  assert.equal(terminalStatus(events, LOAD.LOAD_COMPLETED), undefined);
  await delay(40);
  assert.equal(events.filter(event => event.event === LOAD.EVENT_MQTT_LOAD_TEST_ENDED).length, 1);
});

test('load worker delivers a large complete archive over child IPC before exiting', { timeout: 20000 }, async t => {
  const server = await startBroker(t);
  const publisher = await rawClient(t, server);
  const service = forkWorker(t, 'PlatformMqttLoadWorkerService');
  const settings = loadSettings(server, { loadTestType: 'subscribing', topic: 'archive/#', qos: 1,
    msgCount: 48, timeOut: 8 });
  const subscribed = service.event(LOAD.EVENT_MQTT_LOAD_STATUS_MESSAGE,
    data => data.statusObj.message === LOAD.LOAD_MQTT_CLIENT_SUBSCRIBED);
  service.child.send({ actionType: LOAD.ACTION_START_MQTT_LOAD_TEST,
    data: { loadObj: settings, iId: 'large-archive', inum: 7 } });
  await subscribed;
  const completed = service.event(LOAD.EVENT_MQTT_LOAD_TEST_ENDED);
  for (let index = 0; index < 48; index++) {
    await publish(publisher, 'archive/input', `${index}:` + 'x'.repeat(16384), { qos: 1 });
  }
  const result = await completed;
  const exit = await service.exited;
  assert.equal(exit.code, 0, service.output());
  assert.equal(result.messCount, 48);
  assert.equal(result.qosReceivedMessCount, 48);
  assert.deepEqual(result.archiveData.metaData, { iId: 'large-archive', inum: 7 });
  assert.equal(result.archiveData.receivedMessages.length, 48);
  for (let index = 0; index < 48; index++) {
    assert.equal(result.archiveData.receivedMessages[index].data.payload, `${index}:` + 'x'.repeat(16384));
  }
});
