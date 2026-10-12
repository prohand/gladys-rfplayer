// -----------------------------------------------------------------------------
// Device type: the RFPLAYER DONGLE itself.
//
// Its one feature is the jamming detector built into the dongle: a jammer
// (the classic tool to blind a wireless alarm) is reported as the pseudo
// protocol JAMMING, ON when it starts and OFF when it stops. Shown as a tamper
// sensor: "someone is interfering with the radio". The platform id is the
// dongle MAC, read from the HELLO answer — unique and stable.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { binaryFeature } from './helpers.js';

export const GATEWAY_TYPE = 'rfplayer';

const FEATURE = { JAMMING: 'jamming' };

export const gateway = {
  key: GATEWAY_TYPE,

  ids(gladys, info) {
    return gladys.externalIds(GATEWAY_TYPE, info.mac);
  },

  buildDevice(gladys, info) {
    const ids = this.ids(gladys, info);
    return {
      name: `RFPlayer ${info.model ?? ''}`.trim(),
      external_id: ids.device,
      params: [
        { name: 'MAC', value: `0x${info.mac.toUpperCase()}` },
        { name: 'FIRMWARE', value: String(info.firmware ?? 'unknown') },
      ],
      features: [
        binaryFeature(
          ids,
          FEATURE.JAMMING,
          'Radio jamming',
          DEVICE_FEATURE_CATEGORIES.TAMPER,
          DEVICE_FEATURE_TYPES.TAMPER.BINARY,
        ),
      ],
    };
  },

  /** The state of the jamming feature for a jamming event. */
  jammingState(gladys, info, event) {
    return {
      external_id: this.ids(gladys, info).feature(FEATURE.JAMMING),
      value: event.active ? 1 : 0,
    };
  },
};
