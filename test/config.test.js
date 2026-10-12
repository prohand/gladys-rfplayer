import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  formatActuator,
  normalizeConfig,
  parseActuators,
  parseDetectorKinds,
} from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  const config = normalizeConfig();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.deepEqual(config[key], value, key);
  }
  assert.deepEqual(config.actuatorList, []);
  assert.deepEqual(config.configErrors, []);
});

test('normalizeConfig coerces and bounds the numbers coming from a form', () => {
  const config = normalizeConfig({ port: '4001', jamming_threshold: '42', min_quality: '-3' });
  assert.equal(config.port, 4001);
  assert.equal(config.jamming_threshold, 10);
  assert.equal(config.min_quality, 0);
  assert.equal(normalizeConfig({ port: 'abc' }).port, DEFAULT_CONFIG.port);
});

test('normalizeConfig keeps only known receiver protocols', () => {
  const config = normalizeConfig({ receiver_protocols: ['RTS', 'BOGUS', 'OREGONV3/OWL'] });
  assert.deepEqual(config.receiver_protocols, ['RTS', 'OREGONV3/OWL']);
});

test('parseActuators reads the compact list', () => {
  const { actuators, errors } = parseActuators(
    'Living room shutter = shutter RTS 1; Desk = switch chacon 12 ;Gate = button RTS 2 qualifier=1; Lamp = light X10 a3',
  );
  assert.deepEqual(errors, []);
  assert.equal(actuators.length, 4);
  assert.deepEqual(actuators[0], {
    name: 'Living room shutter',
    kind: 'shutter',
    protocol: 'RTS',
    address: { id: 1 },
    platformId: 'rts-1',
  });
  assert.equal(actuators[1].protocol, 'CHACON');
  assert.equal(actuators[2].qualifier, 1);
  assert.deepEqual(actuators[3].address, { x10: 'A3' });
  assert.equal(actuators[3].platformId, 'x10-a3');
});

test('parseActuators reports every bad entry and keeps the good ones', () => {
  const { actuators, errors } = parseActuators(
    'no equal sign; = switch X10 1; A = fan X10 1; B = switch OREGON 1; C = switch X10 999; D = switch X10 1 colour=red; E = switch X10 2; F = light X10 2',
  );
  assert.deepEqual(
    actuators.map((a) => a.name),
    ['E'],
  );
  assert.equal(errors.length, 7);
  assert.match(errors.at(-1), /declared twice/);
});

test('formatActuator writes back what parseActuators reads', () => {
  const line = formatActuator({
    name: 'Gate; front=1',
    kind: 'button',
    protocol: 'RTS',
    address: { id: 2 },
    qualifier: 1,
  });
  assert.equal(line, 'Gate front 1 = button RTS 2 qualifier=1');
  const { actuators, errors } = parseActuators(line);
  assert.deepEqual(errors, []);
  assert.equal(actuators[0].name, 'Gate front 1');
});

test('parseDetectorKinds', () => {
  const { kinds, errors } = parseDetectorKinds('VISONIC 1166992416 = opening; X2D 1 = boom; nope');
  assert.equal(kinds.get('visonic-1166992416'), 'opening');
  assert.equal(errors.length, 2);
});
