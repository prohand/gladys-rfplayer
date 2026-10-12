import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RfPlayerLink } from '../src/rfplayer/connection.js';
import { createFakeBridge, once } from './helpers/fakeSocket.js';
import { FRAMES, toZia33 } from './helpers/frames.js';

const FAST = {
  commandGapMs: 0,
  requestTimeoutMs: 50,
  reconnectBaseMs: 10,
  reconnectMaxMs: 20,
  pingIntervalMs: 60_000,
};

function startLink(bridge, config = {}) {
  const link = new RfPlayerLink({ ...FAST, createSocket: bridge.createSocket });
  link.configure({
    host: '192.168.1.10',
    port: 4000,
    receiver_protocols: [],
    jamming_threshold: 7,
    ...config,
  });
  link.start();
  return link;
}

test('the handshake reads HELLO, then sends the init commands, then is ready', async () => {
  const bridge = createFakeBridge();
  const link = startLink(bridge, { receiver_protocols: ['RTS'], jamming_threshold: 5 });
  try {
    const info = await once(link, 'ready');
    assert.deepEqual(info, { model: 'RFP1000', firmware: '1.39', mac: 'f6c09fa1' });
    assert.deepEqual(bridge.sockets[0].target, { host: '192.168.1.10', port: 4000 });
    assert.deepEqual(bridge.commands(), [
      'HELLO',
      'FORMAT JSON',
      'RECEIVER - * + RTS',
      'JAMMING 5',
    ]);
    assert.ok(bridge.written.every((line) => line.endsWith('\r')));
    assert.equal(link.ready, true);
  } finally {
    link.stop();
  }
});

test('frames are emitted, even split across TCP chunks', async () => {
  const bridge = createFakeBridge();
  const link = startLink(bridge);
  try {
    await once(link, 'ready');
    const line = toZia33(FRAMES.chaconOn);
    const got = once(link, 'frame');
    bridge.receive(line.slice(0, 30));
    bridge.receive(`${line.slice(30)}\r\n`);
    const frame = await got;
    assert.equal(frame.header.protocolMeaning, 'CHACON');
  } finally {
    link.stop();
  }
});

test('orders are refused before the handshake, sent once ready', async () => {
  const bridge = createFakeBridge();
  const link = startLink(bridge);
  try {
    await assert.rejects(link.order('ON X10 A1'), /not connected/);
    await once(link, 'ready');
    await link.order('ON X10 A1');
    assert.equal(bridge.commands().at(-1), 'ON X10 A1');
  } finally {
    link.stop();
  }
});

test('ping and STATUS SYSTEM answer', async () => {
  const bridge = createFakeBridge();
  const link = startLink(bridge);
  try {
    await once(link, 'ready');
    assert.equal(typeof (await link.ping()), 'number');
    assert.equal((await link.systemStatus()).Version, '1.39');
  } finally {
    link.stop();
  }
});

test('a bridge whose dongle does not answer HELLO is retried, never ready', async () => {
  const bridge = createFakeBridge({ answers: false });
  const link = startLink(bridge);
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(link.ready, false);
    assert.match(link.lastError, /no answer to HELLO/);
    assert.ok(bridge.sockets.length >= 2, 'it reconnects');
  } finally {
    link.stop();
  }
});

test('a lost connection emits down, then reconnects', async () => {
  const bridge = createFakeBridge();
  const link = startLink(bridge);
  try {
    await once(link, 'ready');
    const down = once(link, 'down');
    bridge.sockets[0].destroy();
    await down;
    assert.equal(link.ready, false);
    await once(link, 'ready');
    assert.equal(bridge.sockets.length, 2);
  } finally {
    link.stop();
  }
});

test('a refused connection keeps retrying and says why', async () => {
  const bridge = createFakeBridge({ connect: false });
  const link = startLink(bridge);
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.match(link.lastError, /ECONNREFUSED/);
    assert.ok(bridge.sockets.length >= 2);
  } finally {
    link.stop();
  }
});

test('a new address restarts the link; new settings are pushed live', async () => {
  const bridge = createFakeBridge();
  const link = startLink(bridge);
  try {
    await once(link, 'ready');
    link.configure({
      host: '192.168.1.10',
      port: 4000,
      receiver_protocols: ['X10'],
      jamming_threshold: 3,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(bridge.commands().includes('RECEIVER - * + X10'));
    assert.equal(bridge.sockets.length, 1);
    link.configure({
      host: '192.168.1.11',
      port: 4000,
      receiver_protocols: [],
      jamming_threshold: 3,
    });
    await once(link, 'ready');
    assert.equal(bridge.sockets.at(-1).target.host, '192.168.1.11');
  } finally {
    link.stop();
  }
});

test('without a host the link waits and says so', () => {
  const bridge = createFakeBridge();
  const link = new RfPlayerLink({ ...FAST, createSocket: bridge.createSocket });
  link.configure({ host: '', port: 4000, receiver_protocols: [], jamming_threshold: 7 });
  link.start();
  assert.equal(bridge.sockets.length, 0);
  assert.equal(link.lastError, 'no address configured');
  link.stop();
});

test('a line that never ends is dropped instead of filling the memory', async () => {
  const bridge = createFakeBridge();
  const link = new RfPlayerLink({ ...FAST, maxLineLength: 100, createSocket: bridge.createSocket });
  link.configure({ host: 'h', port: 1, receiver_protocols: [], jamming_threshold: 7 });
  link.start();
  try {
    await once(link, 'ready');
    const invalid = once(link, 'invalid');
    bridge.receive('x'.repeat(200));
    assert.match((await invalid).reason, /too long/);
    assert.equal(link.buffer, '');
  } finally {
    link.stop();
  }
});
