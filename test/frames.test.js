import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFrame, x10Address } from '../src/rfplayer/frames.js';
import { FRAMES } from './helpers/frames.js';

test('Oregon frames become sensor events keyed on model and address', () => {
  const event = decodeFrame(FRAMES.oregonThermoHygro);
  assert.equal(event.kind, 'sensor');
  assert.equal(event.platformId, 'oregon-0x1a2d-54273');
  assert.equal(event.channel, 1);
  assert.deepEqual(
    event.measures.map((m) => [m.type, m.value]),
    [
      ['temperature', 23.4],
      ['hygrometry', 75],
    ],
  );
  assert.equal(event.lowBattery, false);
  assert.equal(event.quality, 4);
});

test('oregon_identity "channel" survives a battery change', () => {
  const event = decodeFrame(FRAMES.oregonThermoHygro, { oregon_identity: 'channel' });
  assert.equal(event.platformId, 'oregon-0x1a2d-ch1');
});

test('OWL meters and rain gauges carry their measures', () => {
  assert.equal(decodeFrame(FRAMES.owl).measures.length, 5);
  assert.deepEqual(
    decodeFrame(FRAMES.oregonRain).measures.map((m) => m.type),
    ['total rain', 'current rain'],
  );
});

test('remote orders of every infoType', () => {
  assert.deepEqual(pick(decodeFrame(FRAMES.chaconOn)), {
    kind: 'remote',
    platformId: 'chacon-146139014',
    order: 'on',
  });
  assert.equal(decodeFrame(FRAMES.blyssOff).order, 'off');
  // infoType 0: the id is an X10 address, 33 = C2.
  assert.deepEqual(pick(decodeFrame(FRAMES.x10On)), {
    kind: 'remote',
    platformId: 'x10-c2',
    order: 'on',
  });
  assert.equal(decodeFrame(FRAMES.rtsUp).order, 'up');
  assert.equal(decodeFrame(FRAMES.rtsMy).order, 'my');
  assert.equal(decodeFrame(FRAMES.x2dRemoteStop).order, 'stop');
  assert.equal(decodeFrame(FRAMES.visonicKeyfob).order, 'key_2');
});

test('detector flags come from the qualifier bits', () => {
  const tamper = decodeFrame(FRAMES.visonicTamper);
  assert.equal(tamper.kind, 'detector');
  assert.equal(tamper.platformId, 'visonic-1166992416');
  assert.deepEqual([tamper.tamper, tamper.alarm, tamper.lowBattery], [true, false, false]);
  const alive = decodeFrame(FRAMES.visonicAlive);
  assert.deepEqual([alive.alarm, alive.supervision], [false, true]);
  const lowBatt = decodeFrame(FRAMES.visonicLowBatt);
  assert.deepEqual([lowBatt.lowBattery, lowBatt.supervision], [true, true]);
  assert.equal(decodeFrame(FRAMES.visonicAlarm).alarm, true);
});

test('a KD101 alert is a smoke detector alarm', () => {
  const event = decodeFrame(FRAMES.kd101Alert);
  assert.equal(event.kind, 'detector');
  assert.equal(event.smoke, true);
  assert.equal(event.alarm, true);
});

test('jamming frames, and frames heard but not used', () => {
  assert.deepEqual(pick(decodeFrame(FRAMES.jammingOn)), { kind: 'jamming', platformId: 'jamming' });
  assert.equal(decodeFrame(FRAMES.jammingOn).active, true);
  assert.equal(decodeFrame(FRAMES.jammingOff).active, false);
  assert.equal(decodeFrame(FRAMES.x2dThermostat).kind, 'other');
  assert.equal(decodeFrame({}), null);
  assert.equal(decodeFrame({ header: { infoType: '4' }, infos: {} }), null);
});

test('x10Address', () => {
  assert.equal(x10Address(0), 'A1');
  assert.equal(x10Address(255), 'P16');
  assert.equal(x10Address('x'), null);
});

function pick(event) {
  const out = { kind: event.kind, platformId: event.platformId };
  if (event.order) out.order = event.order;
  return out;
}
