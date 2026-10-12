// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENE_TRIGGER_KEYS } from '../src/devices/index.js';
import { MANIFEST_ACTIONS } from '../src/capabilities/actions.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { SCENE_ORDERS } from '../src/capabilities/orders.js';
import { RFPLAYER_WIDGET } from '../src/capabilities/widget.js';
import { ACTUATOR_KINDS, DEFAULT_CONFIG } from '../src/config.js';
import { ORDERS } from '../src/rfplayer/frames.js';
import { RECEIVE_PROTOCOLS, SEND_PROTOCOLS } from '../src/rfplayer/protocol.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const byKey = (list, key) => list.find((entry) => entry.key === key);
const optionsOf = (field) => field.options.map((o) => o.value);

// Every list of form fields the manifest declares (same field grammar).
const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

test('scene and widget fields require Gladys >= 5.1.0', () => {
  const [major, minor] = minGladysVersion();
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('1 to 3 catalog categories, a local-only transport', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.deepEqual(manifest.transports, ['local'], 'the RFPlayer never goes through a cloud');
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(MANIFEST_ACTIONS).sort());
});

test('every scene action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGER_KEYS].sort());
});

test('the widget is the one the code serves', () => {
  assert.deepEqual(keysOf(manifest.widgets), [RFPLAYER_WIDGET]);
});

test('select options match what the code accepts', () => {
  const pair = byKey(manifest.actions, 'pair_actuator');
  assert.deepEqual(optionsOf(byKey(pair.fields, 'kind')), ACTUATOR_KINDS);
  assert.deepEqual(optionsOf(byKey(pair.fields, 'protocol')), SEND_PROTOCOLS);
  const send = byKey(manifest.scene_actions, 'send_order');
  assert.deepEqual(optionsOf(byKey(send.fields, 'protocol')), SEND_PROTOCOLS);
  for (const order of optionsOf(byKey(send.fields, 'order'))) {
    assert.ok(SCENE_ORDERS[order], `send_order option "${order}" is not handled`);
  }
  assert.deepEqual(
    optionsOf(byKey(manifest.config_schema, 'receiver_protocols')),
    RECEIVE_PROTOCOLS,
  );
  const remote = byKey(manifest.scene_triggers, 'remote_pressed');
  assert.deepEqual(
    optionsOf(byKey(remote.fields, 'order')).sort(),
    Object.values(ORDERS)
      .filter((o) => o !== ORDERS.ASSOC)
      .sort(),
    'every order a remote can send is a filter option (pairing frames excepted)',
  );
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') continue;
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of allFields.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.ok(!(section.key in DEFAULT_CONFIG), section.key);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
  }
});

test('every text is multi-language, with English and French', () => {
  const texts = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (['label', 'description', 'placeholder'].includes(key)) {
        texts.push([`${path}.${key}`, value]);
      }
      walk(value, `${path}.${key}`);
    }
  };
  walk(manifest, 'manifest');
  assert.ok(texts.length > 50);
  for (const [path, value] of texts) {
    assert.equal(typeof value, 'object', `${path} must be { en, fr }`);
    assert.ok(value.en && value.fr, `${path} needs en and fr`);
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('widget labels hold 3 to 30 characters, descriptions at most 100', () => {
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, text);
    }
    for (const text of Object.values(widget.description)) {
      assert.ok(text.length <= 100, text);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`), manifest.docker_image);
  assert.match(manifest.docker_image, /^ghcr\.io\/prohand\/gladys-rfplayer:/);
});
