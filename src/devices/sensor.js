// -----------------------------------------------------------------------------
// Device type: MEASURING SENSOR (heard on the air).
//
// Oregon Scientific probes (temperature, humidity, pressure, wind, rain, UV),
// OWL energy meters, Cartelectronic TIC… Their frames carry a `measures` list;
// the device gets one feature per measure type it was heard with, so a
// thermometer-only probe never shows an empty humidity tile. A new measure
// type heard later adds a feature (Gladys then offers to update the device in
// the Discovery screen).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { binaryFeature, radioParams } from './helpers.js';

export const SENSOR_TYPE = 'sensor';

export const BATTERY_FEATURE = 'battery-low';

// The measure `type` strings of the RFPlayer JSON frames (lowercased), and how
// each one maps to a Gladys feature. `scale` converts the unit the dongle
// sends to the unit declared.
export const MEASURES = {
  temperature: {
    key: 'temperature',
    name: 'Temperature',
    category: CAT.TEMPERATURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.CELSIUS,
    min: -50,
    max: 80,
  },
  hygrometry: {
    key: 'humidity',
    name: 'Humidity',
    category: CAT.HUMIDITY_SENSOR,
    type: TYPES.SENSOR.INTEGER,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
  },
  pressure: {
    key: 'pressure',
    name: 'Pressure',
    category: CAT.PRESSURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.HECTO_PASCAL,
    min: 800,
    max: 1200,
  },
  'wind speed': {
    key: 'wind-speed',
    name: 'Wind speed',
    category: CAT.SPEED_SENSOR,
    type: TYPES.SPEED_SENSOR.DECIMAL,
    unit: UNITS.METER_PER_SECOND,
    min: 0,
    max: 100,
  },
  direction: {
    key: 'wind-direction',
    name: 'Wind direction',
    category: CAT.ANGLE_SENSOR,
    type: TYPES.SENSOR.INTEGER,
    unit: UNITS.DEGREE,
    min: 0,
    max: 359,
  },
  'total rain': {
    key: 'rain-total',
    name: 'Total rain',
    category: CAT.PRECIPITATION_SENSOR,
    type: TYPES.PRECIPITATION_SENSOR.DECIMAL,
    unit: UNITS.MM,
    min: 0,
    max: 1_000_000,
  },
  'current rain': {
    key: 'rain-rate',
    name: 'Rain rate',
    category: CAT.PRECIPITATION_SENSOR,
    type: TYPES.PRECIPITATION_SENSOR.DECIMAL,
    unit: UNITS.MILLIMETER_PER_HOUR,
    min: 0,
    max: 1000,
  },
  uv: {
    key: 'uv',
    name: 'UV index',
    category: CAT.UV_SENSOR,
    type: TYPES.UV_SENSOR.INTEGER,
    unit: UNITS.UV_INDEX,
    min: 0,
    max: 20,
    round: true,
  },
  energy: {
    key: 'energy',
    name: 'Energy',
    category: CAT.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.ENERGY,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 10_000_000,
    scale: (value, unit) => (/^wh$/i.test(unit) ? value / 1000 : value),
  },
  power: {
    key: 'power',
    name: 'Power',
    category: CAT.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.POWER,
    unit: UNITS.WATT,
    min: 0,
    max: 50_000,
  },
};
for (const phase of [1, 2, 3]) {
  MEASURES[`p${phase}`] = {
    ...MEASURES.power,
    key: `power-${phase}`,
    name: `Power phase ${phase}`,
  };
}

/** Value to publish for one measure, or null when it must not be. */
export function measureValue(measure) {
  const spec = MEASURES[measure.type];
  if (!spec) {
    return null;
  }
  let value = spec.scale ? spec.scale(measure.value, measure.unit) : measure.value;
  if (spec.round) value = Math.round(value);
  return Math.min(spec.max, Math.max(spec.min, value));
}

function deviceName(entry) {
  const brand = entry.protocol.charAt(0) + entry.protocol.slice(1).toLowerCase();
  const model = entry.model ? ` ${entry.model.split(/[,/]/)[0]}` : '';
  const channel = entry.channel ? ` (ch ${entry.channel})` : '';
  return `${brand}${model}${channel}`;
}

export const sensor = {
  key: SENSOR_TYPE,
  kind: 'sensor',

  ids(gladys, entry) {
    return gladys.externalIds(SENSOR_TYPE, entry.platformId);
  },

  buildDevice(gladys, entry) {
    const ids = this.ids(gladys, entry);
    const features = entry.measures
      .map((type) => MEASURES[type])
      .filter(Boolean)
      .map((spec) => ({
        name: spec.name,
        external_id: ids.feature(spec.key),
        category: spec.category,
        type: spec.type,
        unit: spec.unit,
        min: spec.min,
        max: spec.max,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      }));
    if (entry.battery) {
      features.push(
        binaryFeature(
          ids,
          BATTERY_FEATURE,
          'Low battery',
          CAT.BATTERY_LOW,
          TYPES.BATTERY_LOW.BINARY,
        ),
      );
    }
    return {
      name: deviceName(entry),
      external_id: ids.device,
      params: radioParams(entry.protocol, entry.platformId),
      features,
    };
  },

  /** `[{ featureKey, value }]` for one sensor event. */
  statesFor(event) {
    const states = [];
    for (const measure of event.measures) {
      const value = measureValue(measure);
      if (value !== null) {
        states.push({ featureKey: MEASURES[measure.type].key, value });
      }
    }
    if (event.lowBattery !== null) {
      states.push({ featureKey: BATTERY_FEATURE, value: event.lowBattery ? 1 : 0 });
    }
    return states;
  },
};
