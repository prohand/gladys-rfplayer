import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, tick } from './helpers/setup.js';
import { FRAMES } from './helpers/frames.js';

const CHACON_REMOTE = 'ext:rfplayer:remote:chacon-146139014';
const VISONIC = 'ext:rfplayer:detector:visonic-1166992416';
const OREGON = 'ext:rfplayer:sensor:oregon-0x1a2d-54273';
const ACTUATORS =
  'Shutter = shutter RTS 1; Plug = switch CHACON 12; Lamp = light X10 A3; Gate = button RTS 2 qualifier=1; Blind = shutter X2DSHUTTER 3';

test('an emitter not created in Gladys is discovered, nothing is published for it', async () => {
  const { gladys, service } = await createService();
  await service.handleFrame(FRAMES.oregonThermoHygro);
  await tick();
  assert.equal(gladys.calls.states.length, 0);
  assert.equal(gladys.calls.sceneEvents.length, 0);
  const discovered = gladys.calls.discovered.at(-1);
  assert.ok(
    discovered.some((d) => d.external_id === OREGON),
    'rediscovery after a new emitter',
  );
});

test('a created sensor gets its measures, and its last values once created', async () => {
  const { gladys, service } = await createService();
  await service.handleFrame(FRAMES.oregonThermoHygro);
  gladys.create(OREGON, 'Garden');
  await service.onDeviceCreated({ external_id: OREGON });
  assert.deepEqual(gladys.calls.states, [
    { featureExternalId: `${OREGON}:temperature`, state: 23.4 },
    { featureExternalId: `${OREGON}:humidity`, state: 75 },
    { featureExternalId: `${OREGON}:battery-low`, state: 0 },
  ]);
  gladys.calls.states.length = 0;
  await service.handleFrame(FRAMES.oregonThermoHygro);
  assert.equal(gladys.calls.states.length, 3);
});

test('OWL energy is published in kWh', async () => {
  const { gladys, service } = await createService();
  await service.handleFrame(FRAMES.owl);
  gladys.create('ext:rfplayer:sensor:owl-0x0003-784');
  gladys.calls.states.length = 0;
  await service.handleFrame(FRAMES.owl);
  const energy = gladys.calls.states.find((s) => s.featureExternalId.endsWith(':energy'));
  assert.equal(energy.state, 45.15);
});

test('a remote press publishes its order and fires remote_pressed, once per press', async () => {
  const { gladys, service, clock } = await createService();
  gladys.create(CHACON_REMOTE, 'Hall switch');
  await service.handleFrame(FRAMES.chaconOn);
  await service.handleFrame(FRAMES.chaconOn); // the same press, repeated on the air
  assert.deepEqual(gladys.calls.states, [
    { featureExternalId: `${CHACON_REMOTE}:state`, state: 1 },
  ]);
  assert.deepEqual(gladys.calls.sceneEvents, [
    {
      key: 'remote_pressed',
      data: {
        device: CHACON_REMOTE,
        device_name: 'Hall switch',
        protocol: 'CHACON',
        address: '146139014',
        order: 'on',
      },
    },
  ]);
  clock.t += 2000;
  await service.handleFrame(FRAMES.chaconOn);
  assert.equal(gladys.calls.sceneEvents.length, 2, 'a second press later counts');
});

test('frames under the quality threshold are ignored', async () => {
  const { gladys, heard, service } = await createService({ config: { min_quality: 5 } });
  gladys.create('ext:rfplayer:remote:chacon-999');
  await service.handleFrame(FRAMES.weakChacon);
  assert.equal(gladys.calls.states.length, 0);
  assert.equal(heard.ignored, 1);
  assert.equal(heard.list().length, 0);
});

test('a detector fires alarm_detected on the rising edge of alarm and tamper', async () => {
  const { gladys, service } = await createService({
    config: { detector_kinds: 'VISONIC 1166992416 = opening' },
  });
  gladys.create(VISONIC, 'Front door');
  await service.handleFrame(FRAMES.visonicTamper);
  await service.handleFrame(FRAMES.visonicTamper);
  await service.handleFrame(FRAMES.visonicAlarm);
  await service.handleFrame(FRAMES.visonicAlive);
  const events = gladys.calls.sceneEvents.map((e) => `${e.key}:${e.data.event}`);
  assert.deepEqual(events, ['alarm_detected:tamper', 'alarm_detected:alarm']);
  const alarm = gladys.calls.states.filter((s) => s.featureExternalId.endsWith(':alarm'));
  assert.deepEqual(
    alarm.map((s) => s.state),
    [0, 0, 1, 0],
    'a door contact follows every frame',
  );
});

test('a motion alarm falls back to 0 on its own', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gladys, service } = await createService();
  gladys.create(VISONIC);
  await service.handleFrame(FRAMES.visonicAlarm);
  await service.handleFrame(FRAMES.visonicAlive); // says nothing about motion
  let alarm = gladys.calls.states.filter((s) => s.featureExternalId.endsWith(':alarm'));
  assert.deepEqual(
    alarm.map((s) => s.state),
    [1],
  );
  t.mock.timers.tick(60_000);
  alarm = gladys.calls.states.filter((s) => s.featureExternalId.endsWith(':alarm'));
  assert.deepEqual(
    alarm.map((s) => s.state),
    [1, 0],
  );
  await service.stop();
});

test('battery_low fires once when a battery becomes low', async () => {
  const { gladys, service } = await createService();
  gladys.create(VISONIC, 'Kitchen');
  await service.handleFrame(FRAMES.visonicAlive);
  await service.handleFrame(FRAMES.visonicLowBatt);
  await service.handleFrame(FRAMES.visonicLowBatt);
  assert.deepEqual(gladys.calls.sceneEvents, [
    { key: 'battery_low', data: { device: VISONIC, device_name: 'Kitchen' } },
  ]);
});

test('jamming: the trigger fires on every change, the dongle feature follows', async () => {
  const { gladys, heard, service } = await createService();
  heard.setGateway({ model: 'RFP1000', firmware: '1.39', mac: 'f6c09fa1' });
  gladys.create('ext:rfplayer:rfplayer:f6c09fa1');
  await service.handleFrame(FRAMES.jammingOn);
  await service.handleFrame(FRAMES.jammingOn);
  await service.handleFrame(FRAMES.jammingOff);
  assert.deepEqual(
    gladys.calls.sceneEvents.map((e) => e.data.state),
    ['started', 'stopped'],
  );
  assert.deepEqual(
    gladys.calls.states.map((s) => s.state),
    [1, 1, 0],
  );
});

test('jamming frames ignore the quality threshold', async () => {
  const { gladys, service } = await createService({ config: { min_quality: 9 } });
  await service.handleFrame(FRAMES.jammingOn);
  assert.equal(gladys.calls.sceneEvents.length, 1);
});

test('actuator commands become radio orders', async () => {
  const { gladys, link, service } = await createService({ config: { actuators: ACTUATORS } });
  const set = (id, feature, value) =>
    service.onSetValue({ external_id: id }, { external_id: `${id}:${feature}` }, value);

  await set('ext:rfplayer:shutter:rts-1', 'state', 1);
  await set('ext:rfplayer:shutter:rts-1', 'state', 0);
  await set('ext:rfplayer:shutter:rts-1', 'state', -1);
  await set('ext:rfplayer:switch:chacon-12', 'on-off', 1);
  await set('ext:rfplayer:light:x10-a3', 'brightness', 40);
  await set('ext:rfplayer:light:x10-a3', 'brightness', 0);
  await set('ext:rfplayer:light:x10-a3', 'on-off', 1);
  await set('ext:rfplayer:button:rts-2', 'push', 1);
  assert.deepEqual(link.orders, [
    'ON RTS ID 1',
    'DIM RTS ID 1 %4',
    'OFF RTS ID 1',
    'ON CHACON ID 12',
    'DIM X10 A3 %40',
    'OFF X10 A3',
    'ON X10 A3',
    'ON RTS ID 2 QUALIFIER 1',
  ]);
  const lamp = gladys.calls.states.filter((s) => s.featureExternalId.includes('x10-a3'));
  assert.deepEqual(
    lamp.slice(0, 2).map((s) => s.state),
    [40, 1],
  );
  await assert.rejects(set('ext:rfplayer:shutter:x2dshutter-3', 'state', 0), /no stop order/);
  await assert.rejects(set(CHACON_REMOTE, 'state', 1), /not a declared actuator/);
  assert.equal(service.ordersSent, 8);
});

test('a command with the dongle down fails and publishes nothing', async () => {
  const { gladys, service } = await createService({
    ready: false,
    config: { actuators: ACTUATORS },
  });
  await assert.rejects(
    service.onSetValue(
      { external_id: 'ext:rfplayer:switch:chacon-12' },
      { external_id: 'ext:rfplayer:switch:chacon-12:on-off' },
      1,
    ),
    /not connected/,
  );
  assert.equal(gladys.calls.states.length, 0);
});

test('the connection status says what to do', async () => {
  const noHost = await createService({ config: { host: '' }, ready: false });
  await noHost.service.reportStatus();
  assert.match(
    noHost.gladys.calls.connectionStatuses[0].message.en,
    /address of the serial-to-TCP/,
  );

  const down = await createService({ ready: false });
  await down.service.reportStatus();
  assert.match(down.gladys.calls.connectionStatuses[0].message.en, /192\.168\.1\.10:4000/);

  const up = await createService();
  await up.service.onLinkReady({ model: 'RFP1000', firmware: '1.39', mac: 'f6c09fa1' });
  assert.deepEqual(up.gladys.calls.connectionStatuses.at(-1), {
    connected: true,
    message: undefined,
  });
  assert.ok(up.gladys.calls.discovered.at(-1).some((d) => d.name === 'RFPlayer RFP1000'));
  assert.deepEqual(up.gladys.calls.widgetRefreshes, ['rfplayer']);
});

test('applyConfig pushes the settings to the link and reports the errors', async () => {
  const { link, service } = await createService();
  await service.applyConfig({ host: 'h', actuators: 'bad entry' });
  assert.equal(link.configured.at(-1).host, 'h');
  assert.equal(service.config.configErrors.length, 1);
});
