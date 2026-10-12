import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MANIFEST_ACTIONS } from '../src/capabilities/actions.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { buildWidget, describeAge, widgetAction } from '../src/capabilities/widget.js';
import { freeOrderCommand } from '../src/capabilities/orders.js';
import { createService } from './helpers/setup.js';
import { FRAMES } from './helpers/frames.js';

// --- Scene actions -----------------------------------------------------------

test('send_order sends any order and returns the declared outputs', async () => {
  const { link, service } = await createService();
  assert.deepEqual(
    await SCENE_ACTIONS.send_order(service, { protocol: 'RTS', address: '5', order: 'my' }),
    { sent: true, command: 'DIM RTS ID 5 %4' },
  );
  await SCENE_ACTIONS.send_order(service, {
    protocol: 'X10',
    address: 'B2',
    order: 'dim',
    level: 30,
  });
  assert.deepEqual(link.orders, ['DIM RTS ID 5 %4', 'DIM X10 B2 %30']);
});

test('send_order with the dongle down is an output, an invalid order a failure', async () => {
  const { service } = await createService({ ready: false });
  assert.deepEqual(
    await SCENE_ACTIONS.send_order(service, { protocol: 'CHACON', address: '1', order: 'on' }),
    { sent: false, command: 'ON CHACON ID 1' },
  );
  await assert.rejects(
    SCENE_ACTIONS.send_order(service, {
      protocol: 'CHACON',
      address: '1.FACTORYRESET',
      order: 'on',
    }),
  );
  await assert.rejects(
    SCENE_ACTIONS.send_order(service, { protocol: 'CHACON', address: '1', order: 'explode' }),
    /Unknown order/,
  );
});

test('simulate_jamming, scene and configuration screen', async () => {
  const { link, service } = await createService();
  assert.deepEqual(await SCENE_ACTIONS.simulate_jamming(service, { delay: 10 }), { sent: true });
  const message = await MANIFEST_ACTIONS.simulate_jamming(service, {});
  assert.match(message.en, /now/);
  assert.deepEqual(link.orders, ['JAMMING SIMULATE 10', 'JAMMING SIMULATE']);
});

test('freeOrderCommand maps the scene words to the dongle actions', () => {
  assert.equal(freeOrderCommand({ protocol: 'RTS', address: 1, order: 'up' }), 'ON RTS ID 1');
  assert.equal(freeOrderCommand({ protocol: 'RTS', address: 1, order: 'down' }), 'OFF RTS ID 1');
  assert.equal(
    freeOrderCommand({ protocol: 'EDISIO', address: 1, order: 'toggle' }),
    'TOGGLE EDISIO ID 1',
  );
});

// --- Manifest actions ----------------------------------------------------------

test('test_connection reports the dongle, or why it cannot be reached', async () => {
  const up = await createService({ config: { actuators: 'X = switch X10 1; bad' } });
  const ok = await MANIFEST_ACTIONS.test_connection(up.service, {});
  assert.match(ok.en, /RFP1000 OK, firmware 1\.39, answered in 12 ms/);
  assert.match(ok.en, /Receiving: X10 RTS CHACON/);
  assert.match(ok.en, /1 actuator\(s\)/);
  assert.match(ok.en, /Configuration errors/);
  assert.ok(ok.fr);

  const down = await createService({ ready: false });
  assert.match((await MANIFEST_ACTIONS.test_connection(down.service, {})).en, /unreachable/);
  const none = await createService({ ready: false, config: { host: '' } });
  assert.match((await MANIFEST_ACTIONS.test_connection(none.service, {})).en, /Host field/);
});

test('pair_actuator sends ASSOC and appends the actuator to the configuration', async () => {
  const { gladys, link, service } = await createService({
    config: { actuators: 'Plug = switch CHACON 12' },
  });
  const message = await MANIFEST_ACTIONS.pair_actuator(service, {
    name: 'Bedroom shutter',
    kind: 'shutter',
    protocol: 'RTS',
    address: '3',
    send_pairing: true,
  });
  assert.match(message.en, /Bedroom shutter/);
  assert.deepEqual(link.orders, ['ASSOC RTS ID 3']);
  assert.deepEqual(gladys.calls.configs, [
    { actuators: 'Plug = switch CHACON 12; Bedroom shutter = shutter RTS 3' },
  ]);
  assert.equal(service.config.actuatorList.length, 2);
  assert.ok(gladys.calls.discovered.at(-1).some((d) => d.name === 'Bedroom shutter'));
});

test('pair_actuator refuses a duplicate or an invalid address, and sends nothing', async () => {
  const { gladys, link, service } = await createService({
    config: { actuators: 'Plug = switch CHACON 12' },
  });
  await assert.rejects(
    MANIFEST_ACTIONS.pair_actuator(service, {
      name: 'Other',
      kind: 'switch',
      protocol: 'CHACON',
      address: '12',
    }),
    /declared twice/,
  );
  await assert.rejects(
    MANIFEST_ACTIONS.pair_actuator(service, {
      name: 'X',
      kind: 'switch',
      protocol: 'X10',
      address: 'Z9',
    }),
    /Invalid address/,
  );
  assert.equal(link.orders.length, 0);
  assert.equal(gladys.calls.configs.length, 0);
});

test('pair_actuator can declare without pairing, even with the dongle down', async () => {
  const { gladys, link, service } = await createService({ ready: false });
  await MANIFEST_ACTIONS.pair_actuator(service, {
    name: 'X10 module',
    kind: 'light',
    protocol: 'X10',
    address: 'c4',
    send_pairing: false,
  });
  assert.equal(link.orders.length, 0);
  assert.deepEqual(gladys.calls.configs, [{ actuators: 'X10 module = light X10 C4' }]);
});

// --- Widget --------------------------------------------------------------------

test('the widget content is rendered exactly as sent, empty or busy', async () => {
  const empty = await createService({ ready: false, config: { host: '' } });
  assert.deepEqual(validateWidgetContent(buildWidget(empty.service)), []);

  const busy = await createService({ config: { actuators: 'bad' } });
  for (const frame of Object.values(FRAMES)) {
    await busy.service.handleFrame(frame);
  }
  busy.gladys.create('ext:rfplayer:remote:chacon-146139014');
  const content = buildWidget(busy.service, { settings: { emitters: 8 } });
  assert.deepEqual(validateWidgetContent(content), []);
  const list = content.components.find((c) => c.type === 'card-list');
  assert.equal(list.items.length, 8);
  const jamming = content.components.find((c) => c.type === 'status').items.at(-1);
  assert.equal(jamming.color, 'success', 'the last jamming frame was OFF');
});

test('the widget list can be hidden', async () => {
  const { service } = await createService();
  await service.handleFrame(FRAMES.chaconOn);
  const content = buildWidget(service, { settings: { emitters: 0 } });
  assert.equal(
    content.components.some((c) => c.type === 'card-list'),
    false,
  );
});

test('the widget button pings the dongle', async () => {
  const up = await createService();
  assert.match((await widgetAction(up.service, 'ping')).en, /12 ms/);
  const down = await createService({ ready: false });
  assert.match((await widgetAction(down.service, 'ping')).en, /not connected/);
  await assert.rejects(widgetAction(up.service, 'nope'), /Unknown widget action/);
});

test('describeAge', () => {
  assert.deepEqual(describeAge(null, 0), { en: 'never', fr: 'jamais' });
  assert.equal(describeAge(0, 30_000).en, '30 s ago');
  assert.equal(describeAge(0, 3 * 86_400_000).fr, 'il y a 3 j');
});
