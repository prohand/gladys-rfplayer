import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrder,
  initCommands,
  isHelloAnswer,
  parseAddress,
  parseHello,
  parseLine,
  parseSystemStatus,
  toLine,
} from '../src/rfplayer/protocol.js';

test('orders follow the API syntax: action, protocol, address, options', () => {
  assert.equal(buildOrder({ action: 'on', protocol: 'x10', address: 'a1' }), 'ON X10 A1');
  assert.equal(buildOrder({ action: 'OFF', protocol: 'CHACON', address: 12 }), 'OFF CHACON ID 12');
  assert.equal(
    buildOrder({ action: 'DIM', protocol: 'RTS', address: '1', level: 4 }),
    'DIM RTS ID 1 %4',
  );
  assert.equal(
    buildOrder({ action: 'ON', protocol: 'RTS', address: 2, qualifier: 1, burst: 3 }),
    'ON RTS ID 2 BURST 3 QUALIFIER 1',
  );
  assert.equal(
    buildOrder({ action: 'ON', protocol: 'KD101', address: '90500' }),
    'ON KD101 ID 90500',
  );
});

test('orders refuse what the dongle would misread', () => {
  assert.throws(
    () => buildOrder({ action: 'FACTORYRESET', protocol: 'X10', address: 1 }),
    /action/,
  );
  assert.throws(() => buildOrder({ action: 'ON', protocol: 'OREGON', address: 1 }), /transmit/);
  assert.throws(() => buildOrder({ action: 'ON', protocol: 'X10', address: '256' }), /0 to 255/);
  assert.throws(() => buildOrder({ action: 'ON', protocol: 'X10', address: 'Q1' }), /Invalid/);
  assert.throws(() => buildOrder({ action: 'ON', protocol: 'X10', address: '1.FACTORYRESET' }));
  assert.throws(() => buildOrder({ action: 'DIM', protocol: 'X10', address: 1, level: 101 }));
  assert.throws(() => buildOrder({ action: 'DIM', protocol: 'X10', address: 1 }), /DIM level/);
  assert.throws(() => buildOrder({ action: 'ON', protocol: 'X10', address: 1, qualifier: 300 }));
});

test('addresses: X10 form or number, with the per-protocol range', () => {
  assert.deepEqual(parseAddress('X10', 'p16'), { x10: 'P16' });
  assert.deepEqual(parseAddress('CHACON', ' 7 '), { id: 7 });
  assert.throws(() => parseAddress('PARROT', 255), /0 to 254/);
  assert.deepEqual(parseAddress('KD101', '4294967295'), { id: 4294967295 });
});

test('toLine frames a command and never lets a command separator through', () => {
  assert.equal(toLine('HELLO'), 'ZIA++HELLO\r');
  assert.throws(() => toLine('ON X10 A1. FACTORYRESET'), /unsafe/);
  assert.throws(() => toLine('ON X10 A1\rFACTORYRESET'), /unsafe/);
});

test('init: JSON frames, the receivers chosen, the jamming threshold', () => {
  assert.deepEqual(initCommands({ receiver_protocols: [], jamming_threshold: 7 }), [
    'FORMAT JSON',
    'RECEIVER + *',
    'JAMMING 7',
  ]);
  assert.deepEqual(
    initCommands({ receiver_protocols: ['RTS', 'OREGONV3/OWL', 'NOPE'], jamming_threshold: 0 }),
    ['FORMAT JSON', 'RECEIVER - * + RTS OREGONV3/OWL', 'JAMMING 0'],
  );
});

test('parseLine sorts answers, JSON frames and noise', () => {
  assert.deepEqual(parseLine('ZIA--PONG'), { type: 'answer', text: 'PONG' });
  assert.equal(parseLine('garbageZIA--PONG').type, 'answer');
  assert.equal(parseLine('ZIA33{"frame":{"header":{}}}').type, 'frame');
  assert.equal(parseLine('ZIA33{not json').type, 'invalid');
  assert.equal(parseLine('ZIA33{"other":1}').type, 'invalid');
  assert.equal(parseLine('ZIA55 trace line').type, 'trace');
  assert.equal(parseLine('ZIA44 FRAME: text').type, 'invalid');
  assert.equal(parseLine(''), null);
});

test('parseHello reads the model, the firmware and the MAC of the API example', () => {
  const text = 'Welcome to Ziblue Dongle RFPLAYER (RFP1000, Firmware V1.12 Mac 0xF6C09FA1)!';
  assert.ok(isHelloAnswer(text));
  assert.deepEqual(parseHello(text), { model: 'RFP1000', firmware: '1.12', mac: 'f6c09fa1' });
  assert.deepEqual(parseHello('Welcome to Ziblue Dongle'), {
    model: null,
    firmware: null,
    mac: null,
  });
});

test('parseSystemStatus flattens the STATUS SYSTEM JSON answer', () => {
  const text = JSON.stringify({
    systemStatus: {
      reqNum: '0',
      info: [
        { n: 'Version', v: '1.17', unit: '', c: '' },
        { n: 'Mac', v: '0xFD0CBA71', unit: '', c: '' },
        { receiver: { enabled: { p: ['X10', 'RTS'] } } },
      ],
    },
  });
  const status = parseSystemStatus(text);
  assert.equal(status.Version, '1.17');
  assert.deepEqual(status.receiverEnabled, ['X10', 'RTS']);
});
