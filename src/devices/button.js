// -----------------------------------------------------------------------------
// Actuator kind: BUTTON — a gate, a garage door, a doorbell: one order to
// replay, no state to show. Each push sends ON (an RTS portal is declared with
// `qualifier=1`, which the dongle needs to emit the portal frame).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { ACTIONS } from '../rfplayer/protocol.js';
import { actuatorDevice, actuatorFeature, sendOrder } from './helpers.js';

export const BUTTON_KIND = 'button';

const FEATURE = { PUSH: 'push' };

export const button = {
  key: BUTTON_KIND,

  buildDevice(gladys, actuator) {
    const ids = gladys.externalIds(BUTTON_KIND, actuator.platformId);
    return actuatorDevice(ids, actuator, [
      actuatorFeature(
        ids,
        FEATURE.PUSH,
        'Push',
        DEVICE_FEATURE_CATEGORIES.BUTTON,
        DEVICE_FEATURE_TYPES.BUTTON.PUSH,
        { keep_history: false },
      ),
    ]);
  },

  async onSetValue(_gladys, { actuator, link }) {
    await sendOrder(link, actuator, ACTIONS.ON);
  },
};
