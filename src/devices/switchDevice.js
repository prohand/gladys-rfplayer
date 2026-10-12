// -----------------------------------------------------------------------------
// Actuator kind: SWITCH — a plug, a relay, a light without dimming.
// ON / OFF orders on any transmitting protocol (Chacon/DiO, X10, Blyss…).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { ACTIONS } from '../rfplayer/protocol.js';
import { actuatorDevice, actuatorFeature, sendOrder } from './helpers.js';

export const SWITCH_KIND = 'switch';

const FEATURE = { ON_OFF: 'on-off' };

export const switchDevice = {
  key: SWITCH_KIND,

  buildDevice(gladys, actuator) {
    const ids = gladys.externalIds(SWITCH_KIND, actuator.platformId);
    return actuatorDevice(ids, actuator, [
      actuatorFeature(
        ids,
        FEATURE.ON_OFF,
        'On/Off',
        DEVICE_FEATURE_CATEGORIES.SWITCH,
        DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      ),
    ]);
  },

  async onSetValue(gladys, { actuator, feature, value, link }) {
    const on = Number(value) > 0;
    await sendOrder(link, actuator, on ? ACTIONS.ON : ACTIONS.OFF);
    await gladys.publishState(feature.external_id, on ? 1 : 0);
  },
};
