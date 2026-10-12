// -----------------------------------------------------------------------------
// Actuator kind: SHUTTER — Somfy RTS above all (also X2D shutters).
//
// The radio carries orders, never positions: the device has an open / stop /
// close state only. On RTS, open is ON, close is OFF and stop is the "my"
// button, played with DIM %4 (API spec): it stops a moving shutter, and sends
// a still one to its favourite position — exactly what the remote does.
// Pairing (once): hold PROG on the shutter's own remote, then run "Pair an
// actuator" — the dongle sends the RTS ASSOC frame.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { ACTIONS, RTS_MY_LEVEL } from '../rfplayer/protocol.js';
import { actuatorDevice, actuatorFeature, sendOrder } from './helpers.js';
import { SHUTTER_STATE } from './remote.js';

export const SHUTTER_KIND = 'shutter';

const FEATURE = { STATE: 'state' };

export const shutter = {
  key: SHUTTER_KIND,

  buildDevice(gladys, actuator) {
    const ids = gladys.externalIds(SHUTTER_KIND, actuator.platformId);
    return actuatorDevice(ids, actuator, [
      actuatorFeature(
        ids,
        FEATURE.STATE,
        'State',
        DEVICE_FEATURE_CATEGORIES.SHUTTER,
        DEVICE_FEATURE_TYPES.SHUTTER.STATE,
        { min: -1, max: 1 },
      ),
    ]);
  },

  async onSetValue(gladys, { actuator, feature, value, link }) {
    const state = Math.sign(Number(value));
    if (Number.isNaN(state)) {
      throw new Error(`Invalid shutter state ${value}`);
    }
    if (state === SHUTTER_STATE.OPEN) {
      await sendOrder(link, actuator, ACTIONS.ON);
    } else if (state === SHUTTER_STATE.CLOSE) {
      await sendOrder(link, actuator, ACTIONS.OFF);
    } else if (actuator.protocol === 'RTS') {
      await sendOrder(link, actuator, ACTIONS.DIM, RTS_MY_LEVEL);
    } else {
      throw new Error(`${actuator.protocol} has no stop order`);
    }
    await gladys.publishState(feature.external_id, state);
  },
};
