'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CLIENT, startBroker, clientSettings, observeWorker, clientEvent, connectWorker,
  subscribeWorker, unsubscribeWorker, rawClient, publish, delay, forkWorker, waitFor } = require('./helpers/mqtt-harness.cjs');

for (const qos of [0, 1, 2]) {
  test(`connection worker delivers QoS ${qos} and completes its protocol acknowledgement`, { timeout: 15000 }, async t => {
    const server = await startBroker(t);
    const { worker } = observeWorker(t);
    const settings = clientSettings(server);
    await connectWorker(worker, settings);
    const topic = `qos/${qos}`;
    await subscribeWorker(worker, topic, String(qos));
    const sent = [];
    const received = [];
    worker.client.on('packetsend', packet => sent.push(packet.cmd));
    worker.client.on('packetreceive', packet => received.push(packet.cmd));
    const delivered = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED);
    const published = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_PUBLISHED_MESSAGE);
    const brokerPublished = waitFor(server.broker, 'publish', (packet, client) =>
      client && client.id === settings.mqttClientId && packet.topic === topic);
    worker.processAction({ actionType: CLIENT.ACTION_PUBLISH_MESSAGE,
      data: { topic, payload: `payload-${qos}-中文`, qos: String(qos), retain: false, pubId: 'publisher-1' } });
    const [message, confirmation] = await Promise.all([delivered, published, brokerPublished]);
    assert.equal(message.message, `payload-${qos}-中文`);
    assert.equal(message.topic, topic);
    assert.equal(message.packet.topic, topic);
    assert.equal(message.packet.qos, qos);
    assert.equal(confirmation.pubId, 'publisher-1');
    assert.equal(confirmation.mcsId, settings.mcsId);
    assert.equal(confirmation.payload, `payload-${qos}-中文`);
    assert.ok(confirmation.qosResponseReceivedTime >= confirmation.publishedTime);
    assert.ok(sent.includes('publish'));
    if (qos === 1) assert.ok(received.includes('puback'), 'QoS 1 confirmation follows PUBACK');
    if (qos === 2) {
      assert.ok(received.includes('pubrec'), 'QoS 2 receives PUBREC');
      assert.ok(sent.includes('pubrel'), 'QoS 2 sends PUBREL');
      assert.ok(received.includes('pubcomp'), 'QoS 2 confirmation follows PUBCOMP');
    }
    const brokerPacket = server.packets.find(packet => packet.clientId === settings.mqttClientId);
    assert.deepEqual(brokerPacket, { clientId: settings.mqttClientId, topic, payload: `payload-${qos}-中文`, qos, retain: false });
  });
}

test('wildcard subscriptions preserve the matching filter and unsubscribe removes delivery', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  const { worker, events } = observeWorker(t);
  await connectWorker(worker, clientSettings(server));
  await subscribeWorker(worker, 'sensors/+/temperature', '1');
  await subscribeWorker(worker, 'sensors/#', '1');
  await subscribeWorker(worker, 'sensors/+/temperature', '1');
  const publisher = await rawClient(t, server);
  const matching = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED,
    data => data.topic === 'sensors/+/temperature');
  const broad = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED,
    data => data.topic === 'sensors/#');
  await publish(publisher, 'sensors/room/temperature', '21.5', { qos: 1 });
  const messages = await Promise.all([matching, broad]);
  assert.deepEqual(messages.map(data => data.topic).sort(), ['sensors/#', 'sensors/+/temperature']);
  assert.ok(messages.every(data => data.packet.topic === 'sensors/room/temperature' && data.message === '21.5'));
  await unsubscribeWorker(worker, 'sensors/+/temperature');
  const remaining = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED,
    data => data.message === '22');
  await publish(publisher, 'sensors/room/temperature', '22', { qos: 1 });
  assert.equal((await remaining).topic, 'sensors/#');
  await unsubscribeWorker(worker, 'sensors/#');
  await publish(publisher, 'sensors/room/temperature', '23', { qos: 1 });
  await delay(80);
  const deliveries = events.filter(event => event.event === CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED);
  assert.deepEqual(deliveries.map(event => event.data.message), ['21.5', '21.5', '22']);
});

test('a new subscription receives retained payload and its retained flag', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  const publisher = await rawClient(t, server);
  await publish(publisher, 'retained/config', 'persisted-config', { qos: 1, retain: true });
  const { worker } = observeWorker(t);
  await connectWorker(worker, clientSettings(server));
  const retained = clientEvent(worker, CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED);
  await subscribeWorker(worker, 'retained/#', '1');
  const message = await retained;
  assert.equal(message.message, 'persisted-config');
  assert.equal(message.topic, 'retained/#');
  assert.equal(message.packet.topic, 'retained/config');
  assert.equal(message.packet.retain, true);
});

test('connection worker exchanges messages and disconnects through real child IPC', { timeout: 15000 }, async t => {
  const server = await startBroker(t);
  const service = forkWorker(t, 'PlatformMqttClientWorkerService');
  const settings = clientSettings(server);
  service.child.send({ actionType: CLIENT.ACTION_MQTT_CLIENT_CONNECT, data: settings });
  await service.event(CLIENT.EVENT_MQTT_CLIENT_CONN_STATE_CHANGED, data => data.connState === CLIENT.CONNECTION_STATE_CONNECTED);
  const subscribed = new Promise(resolve => server.broker.once('subscribe', resolve));
  service.child.send({ actionType: CLIENT.ACTION_SUBSCRIBE_TO_TOPIC, data: { topic: 'ipc/#', qos: '2' } });
  await subscribed;
  const publisher = await rawClient(t, server);
  await publish(publisher, 'ipc/message', 'real child process', { qos: 2 });
  const received = await service.event(CLIENT.EVENT_MQTT_CLIENT_SUBSCRIBED_DATA_RECIEVED);
  assert.equal(received.packet.topic, 'ipc/message');
  assert.equal(received.packet.qos, 2);
  assert.equal(received.message, 'real child process');
  service.child.send({ actionType: CLIENT.ACTION_MQTT_CLIENT_DISCONNECT });
  await service.event(CLIENT.EVENT_MQTT_CLIENT_CONNECTION_CLOSED);
  const exit = await service.exited;
  assert.equal(exit.code, 0, service.output());
});
