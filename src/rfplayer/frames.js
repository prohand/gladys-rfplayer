// -----------------------------------------------------------------------------
// Decoding of the frames the RFPlayer hears (`ZIA33` JSON lines).
//
// One frame becomes one plain event, whatever the protocol:
//   - `sensor`   : measures (Oregon, OWL, TIC…), plus an optional low battery;
//   - `detector` : alarm / tamper / low battery flags (Visonic, X2D, KD101);
//   - `remote`   : an order heard from a remote (Chacon, X10, RTS, Blyss…);
//   - `jamming`  : the dongle's own jamming detector, started or stopped;
//   - `other`    : decoded but not used (X2D thermostats, Edisio…), kept so
//                  the widget can still say it was heard.
//
// Every value in the JSON is a STRING ("frameType": "0"…) and the field set
// depends on `infoType` (API spec §5.2.2): read everything defensively.
// -----------------------------------------------------------------------------

/** Orders a remote can carry, as the scene trigger spells them. */
export const ORDERS = {
  ON: 'on',
  OFF: 'off',
  DIM: 'dim',
  BRIGHT: 'bright',
  ALL_ON: 'all_on',
  ALL_OFF: 'all_off',
  UP: 'up',
  DOWN: 'down',
  MY: 'my',
  STOP: 'stop',
  ASSOC: 'assoc',
  LEFT: 'left',
  RIGHT: 'right',
  KEY_1: 'key_1',
  KEY_2: 'key_2',
  KEY_3: 'key_3',
  KEY_4: 'key_4',
};

// infoType 0 (X10, Domia, Parrot) and 1 (Chacon, Blyss, X10 32 bits, FS20).
const ON_OFF_ORDERS = {
  0: ORDERS.OFF,
  1: ORDERS.ON,
  2: ORDERS.BRIGHT,
  3: ORDERS.DIM,
  4: ORDERS.ALL_OFF,
  5: ORDERS.ALL_ON,
};

// infoType 3 (Somfy RTS), qualifier D0:4.
const RTS_ORDERS = { 1: ORDERS.DOWN, 4: ORDERS.MY, 7: ORDERS.UP, 13: ORDERS.ASSOC };
const RTS_PORTAL_ORDERS = { 5: ORDERS.LEFT, 6: ORDERS.RIGHT };

// infoType 11 subType 1 (X2D remote / shutter).
const X2D_REMOTE_ORDERS = { 1: ORDERS.ON, 2: ORDERS.OFF, 3: ORDERS.STOP };

// infoType 2 subType 1 (Visonic CodeSecure keyfob), the key in the qualifier.
const VISONIC_KEYS = {
  0x08: ORDERS.KEY_1,
  0x10: ORDERS.KEY_2,
  0x20: ORDERS.KEY_3,
  0x40: ORDERS.KEY_4,
};

const str = (value) => (value === undefined || value === null ? '' : String(value).trim());
const int = (value) => {
  const n = Number.parseInt(str(value), 10);
  return Number.isFinite(n) ? n : null;
};
const slug = (value) =>
  str(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * The X10 form of an infoType 0 id: housecode on D7:4, unit on D3:0.
 * `33` -> `C2`.
 */
export function x10Address(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 0 || n > 255) {
    return null;
  }
  return `${String.fromCharCode(65 + (n >> 4))}${(n & 0x0f) + 1}`;
}

/**
 * The identity of a measuring sensor.
 *
 * Oregon and OWL probes draw a random address (`adr`) at every battery change:
 * keying on it creates a new device each time, keying on the model and the
 * channel switch survives the change but merges two identical probes set on
 * the same channel. The user picks (`oregon_identity`).
 */
function sensorIdentity(protocol, infos, identity) {
  const model = slug(infos.id_PHY);
  if (model) {
    const channel = int(infos.channel) ?? 0;
    if (identity === 'channel') {
      return `${slug(protocol)}-${model}-ch${channel}`;
    }
    const adrChannel = int(infos.adr_channel);
    return `${slug(protocol)}-${model}-${adrChannel ?? `ch${channel}`}`;
  }
  const id = slug(infos.id);
  return id ? `${slug(protocol)}-${id}` : null;
}

function parseMeasures(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((m) => ({ type: str(m?.type).toLowerCase(), value: Number(m?.value), unit: str(m?.unit) }))
    .filter((m) => m.type && Number.isFinite(m.value));
}

/**
 * Decode one frame object (the content of `{"frame": ...}`).
 *
 * @param {object} frame
 * @param {{ oregon_identity?: string }} [options]
 * @returns {object|null} the event, or null when the frame carries nothing usable
 */
export function decodeFrame(frame, options = {}) {
  const header = frame?.header ?? {};
  const infos = frame?.infos ?? {};
  const protocol = str(header.protocolMeaning).toUpperCase() || `P${str(header.protocol)}`;
  const infoType = int(header.infoType);
  const subType = int(infos.subType);
  const qualifier = int(infos.qualifier) ?? 0;

  const base = {
    protocol,
    infoType,
    quality: int(header.rfQuality),
    rfLevel: int(header.rfLevel),
    frequency: int(header.frequency),
  };

  // The jamming detector is a pseudo protocol with a single device, ID 0.
  if (protocol === 'JAMMING') {
    return { ...base, kind: 'jamming', platformId: 'jamming', active: subType === 1 };
  }

  const measures = parseMeasures(infos.measures).filter(
    // API spec, infoType 4: "0 means hygrometry not available on device". Kept,
    // it would give a thermometer-only probe a humidity feature stuck empty.
    (m) => !(m.type === 'hygrometry' && m.value === 0),
  );
  if (measures.length > 0 || (infoType >= 4 && infoType <= 9) || infoType === 13) {
    const platformId = sensorIdentity(protocol, infos, options.oregon_identity);
    if (!platformId || measures.length === 0) {
      return null;
    }
    const lowBatt = str(infos.lowBatt);
    return {
      ...base,
      kind: 'sensor',
      platformId,
      model: str(infos.id_PHYMeaning) || null,
      channel: int(infos.channel),
      measures,
      lowBattery: lowBatt === '' ? null : lowBatt === '1',
    };
  }

  const id = str(infos.id);

  // Visonic (2) and X2D (11): subType 0 is a detector, its flags in the
  // qualifier — D0 tamper, D1 alarm, D2 low battery, D3 supervision.
  if ((infoType === 2 || infoType === 11) && subType === 0 && id) {
    return {
      ...base,
      kind: 'detector',
      platformId: `${slug(protocol)}-${slug(id)}`,
      address: id,
      tamper: Boolean(qualifier & 0x01),
      alarm: Boolean(qualifier & 0x02),
      lowBattery: Boolean(qualifier & 0x04),
      supervision: Boolean(qualifier & 0x08),
    };
  }

  // KD101 smoke detectors speak infoType 1: ON is the alert.
  if (protocol === 'KD101' && id) {
    return {
      ...base,
      kind: 'detector',
      platformId: `kd101-${slug(id)}`,
      address: id,
      smoke: true,
      tamper: false,
      alarm: subType === 1,
      lowBattery: false,
      supervision: subType !== 1,
    };
  }

  let order = null;
  let address = id;
  if (infoType === 0) {
    order = ON_OFF_ORDERS[subType] ?? null;
    address = x10Address(id) ?? id;
  } else if (infoType === 1) {
    order = ON_OFF_ORDERS[subType] ?? null;
  } else if (infoType === 3) {
    const code = qualifier & 0x1f;
    order = (subType === 1 ? RTS_PORTAL_ORDERS[code] : RTS_ORDERS[code]) ?? null;
  } else if (infoType === 11 && subType === 1) {
    order = X2D_REMOTE_ORDERS[qualifier] ?? null;
  } else if (infoType === 2 && subType === 1) {
    order = VISONIC_KEYS[qualifier & 0x78] ?? null;
  }

  if (order && address) {
    return {
      ...base,
      kind: 'remote',
      platformId: `${slug(protocol)}-${slug(address)}`,
      address: String(address),
      order,
      portal: infoType === 3 && subType === 1,
    };
  }

  if (!id) {
    return null;
  }
  return { ...base, kind: 'other', platformId: `${slug(protocol)}-${slug(id)}`, address: id };
}
