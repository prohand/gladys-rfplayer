import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_TRANSPORTS,
} from '@gladysassistant/integration-sdk';
import {
  buildDiscoveredDevices,
  buildTransportBatches,
  findActuator,
} from '../src/devices/index.js';
import { measureValue } from '../src/devices/sensor.js';
import { normalizeConfig } from '../src/config.js';
import { HeardRegistry } from '../src/rfplayer/heard.js';
import { decodeFrame } from '../src/rfplayer/frames.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { FRAMES } from './helpers/frames.js';

const ACTUATORS =
  'Shutter = shutter RTS 1; Plug = switch CHACON 12; Lamp = light X10 A3; Gate = button RTS 2 qualifier=1';

function discover(frames = [], raw = {}) {
  const gladys = createFakeGladys();
  const heard = new HeardRegistry({ file: null });
  for (const frame of frames) heard.record(decodeFrame(frame));
  const config = normalizeConfig({ actuators: ACTUATORS, ...raw });
  return { gladys, heard, config, devices: buildDiscoveredDevices(gladys, config, heard) };
}

const byName = (devices, re) => devices.find((d) => re.test(d.name));

test('every discovered feature declares min, max and a known category', () => {
  const { devices } = discover(Object.values(FRAMES));
  const categories = new Set(Object.values(CAT));
  assert.ok(devices.length >= 10);
  for (const device of devices) {
    assert.ok(device.features.length > 0, device.name);
    for (const feature of device.features) {
      assert.ok(categories.has(feature.category), `${device.name}: ${feature.category}`);
      assert.equal(typeof feature.min, 'number', `${feature.external_id} min`);
      assert.equal(typeof feature.max, 'number', `${feature.external_id} max`);
      assert.ok(feature.external_id.startsWith(device.external_id));
    }
  }
  const ids = devices.flatMap((d) => [d.external_id, ...d.features.map((f) => f.external_id)]);
  assert.equal(new Set(ids).size, ids.length, 'external ids are unique');
});

test('the declared actuators are discovered with writable features', () => {
  const { devices } = discover();
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Shutter', 'Plug', 'Lamp', 'Gate'],
  );
  const shutter = byName(devices, /Shutter/);
  assert.equal(shutter.external_id, 'ext:rfplayer:shutter:rts-1');
  assert.equal(shutter.features[0].type, TYPES.SHUTTER.STATE);
  assert.deepEqual([shutter.features[0].min, shutter.features[0].max], [-1, 1]);
  assert.equal(byName(devices, /Lamp/).features.length, 2);
  for (const device of devices) {
    for (const feature of device.features) {
      assert.equal(feature.read_only, false);
      assert.equal(feature.has_feedback, false, 'radio orders are never acknowledged');
    }
  }
});

test('a thermometer-only probe gets no humidity feature, and a battery flag', () => {
  const { devices } = discover([FRAMES.oregonThermoOnly]);
  const probe = devices.find((d) => d.external_id.includes(':sensor:'));
  assert.deepEqual(
    probe.features.map((f) => f.category),
    [CAT.TEMPERATURE_SENSOR, CAT.BATTERY_LOW],
    'a hygrometry of 0 means "not available" (API spec)',
  );
  assert.equal(measureValue({ type: 'temperature', value: -120 }), -50, 'bounded to min/max');
  assert.equal(measureValue({ type: 'unknown thing', value: 1 }), null);
});

test('detectors take the kind the user gave them', () => {
  const plain = discover([FRAMES.visonicTamper]).devices;
  const motion = plain.find((d) => d.external_id.includes(':detector:'));
  assert.equal(motion.features[0].category, CAT.MOTION_SENSOR);
  assert.equal(motion.features.length, 3);

  const typed = discover([FRAMES.visonicTamper], {
    detector_kinds: 'VISONIC 1166992416 = opening',
  }).devices;
  const opening = typed.find((d) => d.external_id.includes(':detector:'));
  assert.equal(opening.features[0].category, CAT.OPENING_SENSOR);
  assert.equal(opening.features[0].external_id, motion.features[0].external_id, 'same ids');

  const smoke = discover([FRAMES.kd101Alert]).devices.find((d) => /kd101/.test(d.external_id));
  assert.deepEqual(
    smoke.features.map((f) => f.category),
    [CAT.SMOKE_SENSOR],
  );
});

test('an RTS remote shows up/my/down as a shutter state, others as on/off', () => {
  const { devices } = discover([FRAMES.rtsUp, FRAMES.chaconOn]);
  const rts = devices.find((d) => d.external_id === 'ext:rfplayer:remote:rts-6793524');
  assert.equal(rts.features[0].category, CAT.SHUTTER);
  const chacon = devices.find((d) => d.external_id === 'ext:rfplayer:remote:chacon-146139014');
  assert.equal(chacon.features[0].category, CAT.SWITCH);
  assert.equal(chacon.features[0].read_only, true);
});

test('the dongle itself is discovered once its MAC is known', () => {
  const { gladys, heard, config } = discover();
  heard.setGateway({ model: 'RFP1000', firmware: '1.39', mac: 'f6c09fa1' });
  const [dongle] = buildDiscoveredDevices(gladys, config, heard);
  assert.equal(dongle.external_id, 'ext:rfplayer:rfplayer:f6c09fa1');
  assert.equal(dongle.features[0].category, CAT.TAMPER);
});

test('frames that map to nothing are not discovered', () => {
  const { devices } = discover([FRAMES.x2dThermostat], { actuators: '' });
  assert.equal(devices.length, 0);
});

test('findActuator routes a Gladys device back to its declaration', () => {
  const { gladys, config } = discover();
  assert.equal(findActuator(gladys, config, 'ext:rfplayer:switch:chacon-12').actuator.name, 'Plug');
  assert.equal(findActuator(gladys, config, 'ext:rfplayer:remote:chacon-12'), null);
});

test('transport badges: local while connected, in batches of 100', () => {
  const gladys = createFakeGladys();
  for (let i = 0; i < 150; i += 1) gladys.create(`ext:rfplayer:switch:x10-${i}`);
  const up = buildTransportBatches(gladys, true);
  assert.deepEqual(
    up.map((b) => b.length),
    [100, 50],
  );
  assert.equal(up[0][0].transport, DEVICE_TRANSPORTS.LOCAL);
  assert.equal(buildTransportBatches(gladys, false)[1][0].transport, DEVICE_TRANSPORTS.UNREACHABLE);
});
