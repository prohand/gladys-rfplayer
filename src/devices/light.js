// -----------------------------------------------------------------------------
// Actuator kind: DIMMABLE LIGHT — on/off + brightness (DIM %x).
// Protocols with a real dimming order: X10, Chacon/DiO dimmers, FS20…
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { ACTIONS } from '../rfplayer/protocol.js';
import { actuatorDevice, actuatorFeature, sendOrder } from './helpers.js';

export const LIGHT_KIND = 'light';

const FEATURE = { ON_OFF: 'on-off', BRIGHTNESS: 'brightness' };

export const light = {
  key: LIGHT_KIND,

  buildDevice(gladys, actuator) {
    const ids = gladys.externalIds(LIGHT_KIND, actuator.platformId);
    return actuatorDevice(ids, actuator, [
      actuatorFeature(
        ids,
        FEATURE.ON_OFF,
        'On/Off',
        DEVICE_FEATURE_CATEGORIES.LIGHT,
        DEVICE_FEATURE_TYPES.LIGHT.BINARY,
      ),
      actuatorFeature(
        ids,
        FEATURE.BRIGHTNESS,
        'Brightness',
        DEVICE_FEATURE_CATEGORIES.LIGHT,
        DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS,
        { unit: DEVICE_FEATURE_UNITS.PERCENT, min: 0, max: 100 },
      ),
    ]);
  },

  async onSetValue(gladys, { actuator, feature, value, link }) {
    const ids = gladys.externalIds(LIGHT_KIND, actuator.platformId);
    if (feature.external_id === ids.feature(FEATURE.BRIGHTNESS)) {
      const level = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      // DIM %0 is not "off" on every receiver: send OFF for it.
      await sendOrder(link, actuator, level > 0 ? ACTIONS.DIM : ACTIONS.OFF, level);
      await gladys.publishStates([
        { device_feature_external_id: ids.feature(FEATURE.BRIGHTNESS), state: level },
        { device_feature_external_id: ids.feature(FEATURE.ON_OFF), state: level > 0 ? 1 : 0 },
      ]);
      return;
    }
    const on = Number(value) > 0;
    await sendOrder(link, actuator, on ? ACTIONS.ON : ACTIONS.OFF);
    await gladys.publishState(ids.feature(FEATURE.ON_OFF), on ? 1 : 0);
  },
};
