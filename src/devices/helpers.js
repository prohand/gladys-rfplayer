// -----------------------------------------------------------------------------
// Small helpers shared by the device modules.
// -----------------------------------------------------------------------------

import { buildOrder } from '../rfplayer/protocol.js';

/** Has the user created this device in Gladys? (`gladys.devices` is kept by the SDK.) */
export function isCreated(gladys, externalId) {
  return (gladys.devices ?? []).some((device) => device.external_id === externalId);
}

/** The name the user gave a created device, or null. */
export function createdName(gladys, externalId) {
  return (gladys.devices ?? []).find((device) => device.external_id === externalId)?.name ?? null;
}

/** Device params shown in Gladys, so the user can tell two emitters apart. */
export function radioParams(protocol, address) {
  const params = [{ name: 'PROTOCOL', value: String(protocol) }];
  if (address !== null && address !== undefined && address !== '') {
    params.push({ name: 'ADDRESS', value: String(address) });
  }
  return params;
}

/** A read-only binary feature (every feature declares min/max: NOT NULL in Gladys). */
export function binaryFeature(ids, key, name, category, type) {
  return {
    name,
    external_id: ids.feature(key),
    category,
    type,
    min: 0,
    max: 1,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/**
 * Send one radio order to a declared actuator. Radio orders are never
 * acknowledged (433/868 MHz receivers do not answer), so the features of an
 * actuator are `has_feedback: false` and show the value Gladys sent.
 */
export async function sendOrder(link, actuator, action, level) {
  const command = buildOrder({
    action,
    protocol: actuator.protocol,
    address: actuator.address,
    level,
    qualifier: actuator.qualifier,
    burst: actuator.burst,
  });
  await link.order(command);
  return command;
}

/** A controllable feature of a declared actuator. */
export function actuatorFeature(ids, key, name, category, type, extra = {}) {
  return {
    name,
    external_id: ids.feature(key),
    category,
    type,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: false,
    keep_history: true,
    ...extra,
  };
}

/** The device payload shared by every actuator kind. */
export function actuatorDevice(ids, actuator, features) {
  return {
    name: actuator.name,
    external_id: ids.device,
    params: radioParams(actuator.protocol, actuator.address.x10 ?? actuator.address.id),
    features,
  };
}
