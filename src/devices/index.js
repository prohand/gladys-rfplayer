// -----------------------------------------------------------------------------
// Device registry.
//
// Two families of devices:
//   - HEARD devices (sensor, detector, remote): they exist because the dongle
//     heard them; their list comes from the HeardRegistry (src/rfplayer/heard.js);
//   - DECLARED actuators (switch, light, shutter, button): the radio cannot
//     discover a receiver, so the user lists them in the `actuators` setting.
// Plus the dongle itself (gateway.js), once its HELLO gave its MAC.
//
// The heard blueprints expose:
//   - kind                         : the event kind they consume (frames.js)
//   - ids(gladys, entry)           : the external ids of an emitter
//   - buildDevice(gladys, entry, config)
//   - statesFor(event, entry, config) -> [{ featureKey, value, resetAfterMs? }]
// The actuator blueprints expose:
//   - buildDevice(gladys, actuator)
//   - onSetValue(gladys, { actuator, feature, value, link })
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { gateway } from './gateway.js';
import { sensor } from './sensor.js';
import { detector, FEATURE as DETECTOR_FEATURE } from './detector.js';
import { remote } from './remote.js';
import { switchDevice } from './switchDevice.js';
import { light } from './light.js';
import { shutter } from './shutter.js';
import { button } from './button.js';
import { BATTERY_FEATURE } from './sensor.js';
import { createdName, isCreated } from './helpers.js';

export const HEARD_BLUEPRINTS = { sensor, detector, remote };

export const ACTUATOR_BLUEPRINTS = {
  switch: switchDevice,
  light,
  shutter,
  button,
};

/** Keys of the scene triggers the devices fire (checked against the manifest). */
export const SCENE_TRIGGERS = {
  REMOTE_PRESSED: 'remote_pressed',
  ALARM_DETECTED: 'alarm_detected',
  BATTERY_LOW: 'battery_low',
  JAMMING: 'jamming',
};
export const SCENE_TRIGGER_KEYS = Object.values(SCENE_TRIGGERS);

/**
 * The discovery payload: the dongle, the declared actuators, every emitter
 * heard that maps to at least one feature.
 */
export function buildDiscoveredDevices(gladys, config, heard) {
  const devices = [];
  if (heard.gateway?.mac) {
    devices.push(gateway.buildDevice(gladys, heard.gateway));
  }
  for (const actuator of config.actuatorList) {
    devices.push(ACTUATOR_BLUEPRINTS[actuator.kind].buildDevice(gladys, actuator));
  }
  for (const entry of heard.list()) {
    const blueprint = HEARD_BLUEPRINTS[entry.kind];
    if (!blueprint) continue;
    const device = blueprint.buildDevice(gladys, entry, config);
    if (device.features.length > 0) {
      devices.push(device);
    }
  }
  return devices;
}

/** The declared actuator behind a Gladys device, or null. */
export function findActuator(gladys, config, externalId) {
  for (const actuator of config.actuatorList) {
    const blueprint = ACTUATOR_BLUEPRINTS[actuator.kind];
    if (gladys.externalIds(blueprint.key, actuator.platformId).device === externalId) {
      return { blueprint, actuator };
    }
  }
  return null;
}

/** The heard emitter behind a Gladys device, or null. */
export function findHeard(gladys, heard, externalId) {
  for (const entry of heard.list()) {
    const blueprint = HEARD_BLUEPRINTS[entry.kind];
    if (blueprint && blueprint.ids(gladys, entry).device === externalId) {
      return { blueprint, entry };
    }
  }
  return null;
}

const rising = (before, now) => now === 1 && before !== 1;

/**
 * Apply one decoded event: what to publish, which scene events to fire, and
 * whether discovery must be published again.
 *
 * States and scene events only go to devices the user CREATED: the
 * neighbours' probes are heard too, and Gladys would drop (or rate-limit)
 * their states anyway. Values are remembered either way, so a device created
 * later shows its last reading at once (see `replayStates`).
 *
 * @returns {{ states: object[], sceneEvents: object[], rediscover: boolean }}
 */
export function applyEvent(gladys, config, heard, event) {
  const out = { states: [], sceneEvents: [], rediscover: false };

  if (event.kind === 'jamming') {
    const before = heard.jamming?.active ?? null;
    heard.record(event);
    if (heard.gateway?.mac) {
      const state = gateway.jammingState(gladys, heard.gateway, event);
      if (isCreated(gladys, gateway.ids(gladys, heard.gateway).device)) {
        out.states.push(state);
      }
    }
    if (before !== event.active) {
      out.sceneEvents.push({
        key: SCENE_TRIGGERS.JAMMING,
        data: { state: event.active ? 'started' : 'stopped' },
      });
    }
    return out;
  }

  const { entry, shapeChanged } = heard.record(event);
  out.rediscover = shapeChanged && Boolean(HEARD_BLUEPRINTS[event.kind]);
  const blueprint = HEARD_BLUEPRINTS[event.kind];
  if (!blueprint) {
    return out;
  }

  const ids = blueprint.ids(gladys, entry);
  const before = { ...entry.states };
  const states = blueprint.statesFor(event, entry, config);
  for (const state of states) {
    heard.rememberState(entry.kind, entry.platformId, state.featureKey, state.value);
  }
  if (!isCreated(gladys, ids.device)) {
    return out;
  }

  out.states = states.map((state) => ({
    external_id: ids.feature(state.featureKey),
    value: state.value,
    resetAfterMs: state.resetAfterMs ?? null,
    kind: entry.kind,
    platformId: entry.platformId,
    featureKey: state.featureKey,
  }));

  const common = {
    device: ids.device,
    device_name: createdName(gladys, ids.device) ?? '',
    protocol: entry.protocol,
    address: String(entry.address ?? entry.platformId),
  };
  const now = Object.fromEntries(states.map((s) => [s.featureKey, s.value]));

  if (event.kind === 'remote') {
    out.sceneEvents.push({
      key: SCENE_TRIGGERS.REMOTE_PRESSED,
      data: { ...common, order: event.order },
    });
  }
  if (event.kind === 'detector') {
    for (const [feature, name] of [
      [DETECTOR_FEATURE.ALARM, 'alarm'],
      [DETECTOR_FEATURE.TAMPER, 'tamper'],
    ]) {
      if (rising(before[feature], now[feature])) {
        out.sceneEvents.push({
          key: SCENE_TRIGGERS.ALARM_DETECTED,
          data: { ...common, event: name },
        });
      }
    }
  }
  if (rising(before[BATTERY_FEATURE], now[BATTERY_FEATURE])) {
    out.sceneEvents.push({
      key: SCENE_TRIGGERS.BATTERY_LOW,
      data: { device: common.device, device_name: common.device_name },
    });
  }
  return out;
}

/**
 * The last values heard for a device the user just created, ready for
 * publishStates (empty for an actuator or an emitter with nothing known).
 */
export function replayStates(gladys, heard, externalId) {
  const found = findHeard(gladys, heard, externalId);
  if (!found) {
    return [];
  }
  const ids = found.blueprint.ids(gladys, found.entry);
  return Object.entries(found.entry.states).map(([featureKey, value]) => ({
    device_feature_external_id: ids.feature(featureKey),
    state: value,
  }));
}

/**
 * Transport badge of every created device: all of them are reached through
 * the dongle, so they are `local` while it is connected, `unreachable` when
 * it is not. Batches of 100 (the publishTransports limit).
 */
export function buildTransportBatches(gladys, linkReady) {
  const transport = linkReady ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
  const entries = (gladys.devices ?? []).map((device) => ({
    external_id: device.external_id,
    transport,
  }));
  const batches = [];
  for (let i = 0; i < entries.length; i += 100) {
    batches.push(entries.slice(i, i + 100));
  }
  return batches;
}
