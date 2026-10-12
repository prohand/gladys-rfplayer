// -----------------------------------------------------------------------------
// Device type: REMOTE (heard on the air).
//
// Wall switches, keyfobs and remotes of every protocol the dongle decodes:
// Chacon/DiO, X10, Domia, Blyss, Somfy RTS, X2D, Visonic keyfobs, FS20…
// A remote has no state of its own, only orders: the device shows the last
// one (on/off, or up/my/down for an RTS shutter remote) and every press fires
// the `remote_pressed` scene trigger, which carries the exact order.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
} from '@gladysassistant/integration-sdk';
import { ORDERS } from '../rfplayer/frames.js';
import { binaryFeature, radioParams } from './helpers.js';

export const REMOTE_TYPE = 'remote';

const FEATURE = { STATE: 'state' };

// Gladys shutter state values.
export const SHUTTER_STATE = { OPEN: 1, STOP: 0, CLOSE: -1 };

const SWITCH_VALUES = {
  [ORDERS.ON]: 1,
  [ORDERS.ALL_ON]: 1,
  [ORDERS.OFF]: 0,
  [ORDERS.ALL_OFF]: 0,
};
const SHUTTER_VALUES = {
  [ORDERS.UP]: SHUTTER_STATE.OPEN,
  [ORDERS.MY]: SHUTTER_STATE.STOP,
  [ORDERS.DOWN]: SHUTTER_STATE.CLOSE,
};

export const remote = {
  key: REMOTE_TYPE,
  kind: 'remote',

  ids(gladys, entry) {
    return gladys.externalIds(REMOTE_TYPE, entry.platformId);
  },

  buildDevice(gladys, entry) {
    const ids = this.ids(gladys, entry);
    const feature = entry.rts
      ? {
          name: 'Last order',
          external_id: ids.feature(FEATURE.STATE),
          category: CAT.SHUTTER,
          type: TYPES.SHUTTER.STATE,
          min: -1,
          max: 1,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        }
      : binaryFeature(ids, FEATURE.STATE, 'Last order', CAT.SWITCH, TYPES.SWITCH.BINARY);
    return {
      name: `${entry.protocol} remote ${entry.address}`,
      external_id: ids.device,
      params: radioParams(entry.protocol, entry.address),
      features: [feature],
    };
  },

  /** `[{ featureKey, value }]` for one remote event (none for keys, dim…). */
  statesFor(event, entry) {
    const value = entry.rts ? SHUTTER_VALUES[event.order] : SWITCH_VALUES[event.order];
    return value === undefined ? [] : [{ featureKey: FEATURE.STATE, value }];
  },
};
