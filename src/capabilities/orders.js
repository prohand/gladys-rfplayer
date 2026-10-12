// -----------------------------------------------------------------------------
// Free radio orders, as a scene or the Configuration screen asks for them.
//
// The order names are the user's words (up, down, my…), turned into the
// dongle's actions here. Everything is validated by buildOrder: an address or
// a protocol a user typed never reaches the wire unchecked.
// -----------------------------------------------------------------------------

import { ACTIONS, buildOrder, RTS_MY_LEVEL } from '../rfplayer/protocol.js';

/** Orders a scene can send, and the dongle action each one is. */
export const SCENE_ORDERS = {
  on: { action: ACTIONS.ON },
  off: { action: ACTIONS.OFF },
  dim: { action: ACTIONS.DIM },
  up: { action: ACTIONS.ON },
  down: { action: ACTIONS.OFF },
  my: { action: ACTIONS.DIM, level: RTS_MY_LEVEL },
  assoc: { action: ACTIONS.ASSOC },
  dissoc: { action: ACTIONS.DISSOC },
  toggle: { action: ACTIONS.TOGGLE },
};

/**
 * Build the command for a free order.
 * @param {{ protocol: string, address: string|number, order: string, level?: number, qualifier?: number }} fields
 */
export function freeOrderCommand({ protocol, address, order, level, qualifier }) {
  const spec = SCENE_ORDERS[String(order ?? '').toLowerCase()];
  if (!spec) {
    throw new Error(`Unknown order "${order}" (${Object.keys(SCENE_ORDERS).join(', ')})`);
  }
  return buildOrder({
    action: spec.action,
    protocol,
    address,
    level: spec.level ?? (spec.action === ACTIONS.DIM ? Number(level ?? 0) : undefined),
    qualifier,
  });
}

/** `JAMMING SIMULATE [delay]`: the dongle reports a jamming ON, then OFF 5 s later. */
export function simulateJammingCommand(delay) {
  const seconds = Number(delay ?? 0);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 255) {
    throw new Error(`Invalid delay ${delay}: 0 to 255 seconds`);
  }
  return seconds > 0 ? `JAMMING SIMULATE ${seconds}` : 'JAMMING SIMULATE';
}
