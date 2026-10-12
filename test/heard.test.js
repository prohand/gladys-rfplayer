import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeardRegistry } from '../src/rfplayer/heard.js';
import { decodeFrame } from '../src/rfplayer/frames.js';
import { FRAMES } from './helpers/frames.js';

test('record tells when the device shape changes', () => {
  const heard = new HeardRegistry({ file: null });
  const first = heard.record(decodeFrame(FRAMES.chaconOn));
  assert.equal(first.isNew, true);
  assert.equal(first.shapeChanged, true);
  const again = heard.record(decodeFrame(FRAMES.chaconOn));
  assert.equal(again.shapeChanged, false);
  assert.equal(again.entry.frames, 2);
  assert.equal(heard.frames, 2);
});

test('a new measure type changes the shape of a sensor', () => {
  const heard = new HeardRegistry({ file: null });
  const frame = structuredClone(FRAMES.oregonThermoHygro);
  frame.infos.measures = [frame.infos.measures[0]];
  heard.record(decodeFrame(frame));
  assert.equal(heard.record(decodeFrame(FRAMES.oregonThermoHygro)).shapeChanged, true);
});

test('the registry is bounded, the oldest emitters go first', () => {
  let t = 0;
  const heard = new HeardRegistry({ file: null, max: 2, now: () => ++t });
  for (const id of ['1', '2', '3']) {
    const frame = structuredClone(FRAMES.chaconOn);
    frame.infos.id = id;
    heard.record(decodeFrame(frame));
  }
  assert.deepEqual(
    heard.list().map((e) => e.platformId),
    ['chacon-3', 'chacon-2'],
  );
});

test('save and load round-trip through /data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rfplayer-'));
  try {
    const file = join(dir, 'heard.json');
    const heard = new HeardRegistry({ file });
    heard.record(decodeFrame(FRAMES.oregonThermoHygro));
    heard.rememberState('sensor', 'oregon-0x1a2d-54273', 'temperature', 23.4);
    heard.setGateway({ model: 'RFP1000', firmware: '1.39', mac: 'f6c09fa1' });
    await heard.save();
    assert.ok(JSON.parse(await readFile(file, 'utf8')).entries.length === 1);

    const loaded = new HeardRegistry({ file });
    await loaded.load();
    assert.equal(loaded.get('sensor', 'oregon-0x1a2d-54273').states.temperature, 23.4);
    assert.equal(loaded.gateway.mac, 'f6c09fa1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing or broken file is not fatal', async () => {
  const heard = new HeardRegistry({ file: '/nonexistent/dir/heard.json' });
  await heard.load();
  await heard.save();
  assert.equal(heard.list().length, 0);
});
