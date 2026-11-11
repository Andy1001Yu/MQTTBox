'use strict';

const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {test} = require('node:test');
const {LOAD, startBroker, clientSettings, forkWorker, waitFor, bounded, delay} =
  require('./helpers/mqtt-harness.cjs');

// Use the real TCP broker and MQTT worker, delaying only its acknowledgement.
// QoS 2 proceeds through PUBREC/PUBREL before the broker withholds PUBCOMP.
async function brokerWithoutAcknowledgement(t, qos) {
  const pending = [];
  t.after(() => {
    for (const callback of pending) callback(new Error('Acknowledgement fixture closed'));
  });
  const server = await startBroker(t);
  const observed = new EventEmitter();
  const publications = [];
  server.broker.authorizePublish = (client, packet, callback) => {
    publications.push({qos: packet.qos, messageId: packet.messageId,
      topic: packet.topic, payload: packet.payload.toString()});
    if (qos === 1) {
      pending.push(callback);
      observed.emit('acknowledgement-held', packet.messageId);
    } else {
      callback(null);
    }
  };
  if (qos === 2) {
    server.broker.persistence.incomingGetPacket = (client, packet, callback) => {
      pending.push(callback);
      observed.emit('acknowledgement-held', packet.messageId);
    };
  }
  return {...server, observed, publications};
}

for (const qos of [1, 2]) {
  for (const cancellation of ['stop', 'timeout']) {
    test(`${cancellation} ends a QoS ${qos} load while the broker withholds ${qos === 1 ? 'PUBACK' : 'PUBCOMP'}`,
      {timeout: 10000}, async t => {
        const server = await brokerWithoutAcknowledgement(t, qos);
        const service = forkWorker(t, 'PlatformMqttLoadWorkerService');
        const acknowledgementHeld = waitFor(server.observed, 'acknowledgement-held');
        const settings = clientSettings(server, {
          loadTestType: 'publishing', qos, msgCount: 1, runTime: 0.01,
          timeOut: cancellation === 'timeout' ? 0.25 : 4,
          topic: 'load/unacknowledged', payload: ['cancel without a broker acknowledgement']
        });
        service.child.send({actionType: LOAD.ACTION_START_MQTT_LOAD_TEST,
          data: {loadObj: settings, iId: `cancel-${qos}-${cancellation}`, inum: 1}});
        const messageId = await acknowledgementHeld;
        assert.equal(server.publications.length, 1);
        assert.equal(server.publications[0].messageId, messageId);
        assert.equal(server.publications[0].qos, qos);
        assert.equal(server.publications[0].payload, 'cancel without a broker acknowledgement');

        const completed = service.event(LOAD.EVENT_MQTT_LOAD_TEST_ENDED, () => true, 1200);
        if (cancellation === 'stop') {
          service.child.send({actionType: LOAD.ACTION_STOP_MQTT_LOAD_TEST,
            data: {iId: `cancel-${qos}-${cancellation}`}});
        }
        const result = await completed;
        const exit = await bounded(service.exited, 'cancelled worker exit', 1200);
        assert.equal(exit.code, 0, service.output());
        assert.equal(result.messCount, 1, 'the worker must preserve the sent count');
        assert.equal(result.qosReceivedMessCount, 0, 'an unreceived acknowledgement must not be counted');
        assert.equal(result.archiveData, undefined);
        const expectedStatus = cancellation === 'stop' ? LOAD.LOAD_STOPPED : LOAD.LOAD_TIME_OUT;
        const finalStatuses = service.events.filter(event =>
          event.event === LOAD.EVENT_MQTT_LOAD_STATUS_MESSAGE &&
          event.data.statusObj.message === expectedStatus);
        assert.equal(finalStatuses.length, 1);
        assert.equal(finalStatuses[0].data.statusObj.status, LOAD.STATE_ERROR);
        await delay(40);
        assert.equal(service.events.filter(event => event.event === LOAD.EVENT_MQTT_LOAD_TEST_ENDED).length, 1);
        assert.equal(service.events.some(event => event.data && event.data.statusObj &&
          event.data.statusObj.message === LOAD.LOAD_COMPLETED), false);
      });
  }
}
