// -----------------------------------------------------------------------------
// Device type: ALARM DETECTOR (heard on the air).
//
// Visonic PowerCode and X2D detectors carry three flags in every frame: alarm,
// tamper and low battery (plus a supervision bit for their periodic "I am
// alive" frame). KD101 smoke detectors only send an alert.
//
// What the alarm flag MEANS depends on the hardware — a door contact, a
// motion sensor, a smoke detector all look the same on the air — so the
// category of the alarm feature comes from the `detector_kinds` setting
// (motion by default, smoke for KD101). Motion and smoke detectors never send
// "it stopped": their alarm falls back to 0 on its own after a while.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
} from '@gladysassistant/integration-sdk';
import { binaryFeature, radioParams } from './helpers.js';
import { BATTERY_FEATURE } from './sensor.js';

export const DETECTOR_TYPE = 'detector';

export const FEATURE = { ALARM: 'alarm', TAMPER: 'tamper', BATTERY: BATTERY_FEATURE };

// Alarm feature per detector kind, and how long an alarm stays up when the
// hardware never sends the end of it (null: the frame says it).
const KINDS = {
  motion: { name: 'Motion', category: CAT.MOTION_SENSOR, resetAfterMs: 60_000 },
  presence: { name: 'Presence', category: CAT.PRESENCE_SENSOR, resetAfterMs: 120_000 },
  opening: { name: 'Opening', category: CAT.OPENING_SENSOR, resetAfterMs: null },
  smoke: { name: 'Smoke', category: CAT.SMOKE_SENSOR, resetAfterMs: 120_000 },
  leak: { name: 'Leak', category: CAT.LEAK_SENSOR, resetAfterMs: null },
  vibration: { name: 'Vibration', category: CAT.VIBRATION_SENSOR, resetAfterMs: 60_000 },
};

/** The kind of a detector: what the user set, else smoke for KD101, else motion. */
export function detectorKind(entry, config) {
  return config.detectorKinds?.get(entry.platformId) ?? (entry.smoke ? 'smoke' : 'motion');
}

export const detector = {
  key: DETECTOR_TYPE,
  kind: 'detector',

  ids(gladys, entry) {
    return gladys.externalIds(DETECTOR_TYPE, entry.platformId);
  },

  buildDevice(gladys, entry, config) {
    const ids = this.ids(gladys, entry);
    const kind = KINDS[detectorKind(entry, config)];
    const features = [
      binaryFeature(ids, FEATURE.ALARM, kind.name, kind.category, TYPES.SENSOR.BINARY),
    ];
    if (!entry.smoke) {
      features.push(
        binaryFeature(ids, FEATURE.TAMPER, 'Tamper', CAT.TAMPER, TYPES.TAMPER.BINARY),
        binaryFeature(
          ids,
          FEATURE.BATTERY,
          'Low battery',
          CAT.BATTERY_LOW,
          TYPES.BATTERY_LOW.BINARY,
        ),
      );
    }
    return {
      name: `${entry.protocol} ${kind.name.toLowerCase()} detector ${entry.address}`,
      external_id: ids.device,
      params: radioParams(entry.protocol, entry.address),
      features,
    };
  },

  /** `[{ featureKey, value, resetAfterMs? }]` for one detector event. */
  statesFor(event, entry, config) {
    const kind = KINDS[detectorKind(entry, config)];
    const states = [];
    // For a detector that never sends "it stopped" (motion, smoke), a frame
    // without the alarm flag — supervision, tamper — says nothing about the
    // alarm: publishing 0 would cut short the window opened by a detection.
    if (event.alarm || kind.resetAfterMs === null) {
      states.push({
        featureKey: FEATURE.ALARM,
        value: event.alarm ? 1 : 0,
        resetAfterMs: event.alarm ? kind.resetAfterMs : null,
      });
    }
    if (!event.smoke) {
      states.push({ featureKey: FEATURE.TAMPER, value: event.tamper ? 1 : 0 });
      states.push({ featureKey: FEATURE.BATTERY, value: event.lowBattery ? 1 : 0 });
    }
    return states;
  },
};
