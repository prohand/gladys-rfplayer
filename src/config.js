// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of the manifest;
// this module provides the defaults and turns the raw values into what the
// rest of the code uses, so nothing downstream deals with `undefined` or with
// numbers typed as strings.
//
// Two fields are small text formats, because a configuration screen has no
// multi-line input:
//
//   actuators       "Name = kind PROTOCOL address [qualifier=n] [burst=n]; ..."
//                   e.g. "Living room shutter = shutter RTS 1; Desk = switch CHACON 12"
//   detector_kinds  "PROTOCOL id = kind; ..."
//                   e.g. "VISONIC 1166992416 = opening; X2D 7894561 = smoke"
// -----------------------------------------------------------------------------

import {
  addressKey,
  parseAddress,
  RECEIVE_PROTOCOLS,
  SEND_PROTOCOLS,
} from './rfplayer/protocol.js';

/** Kinds of actuator the `actuators` field can declare. */
export const ACTUATOR_KINDS = ['switch', 'light', 'shutter', 'button'];

/** Kinds a detector's alarm can be shown as. */
export const DETECTOR_KINDS = ['motion', 'opening', 'smoke', 'leak', 'vibration', 'presence'];

// Defaults: they MUST stay consistent with the `default` values declared in
// the `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  host: '',
  port: 4000,
  // No manifest default (a multi_select stores an array): an empty list means
  // "every protocol", which is what a fresh dongle does.
  receiver_protocols: [],
  jamming_threshold: 7,
  min_quality: 0,
  oregon_identity: 'address',
  actuators: '',
  detector_kinds: '',
};

const OPTION_KEYS = ['qualifier', 'burst'];

function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Names end up in the `actuators` text itself: keep its separators out. */
export function cleanName(name) {
  return String(name ?? '')
    .replace(/[;=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Parse the `actuators` field.
 * @param {string} text
 * @returns {{ actuators: object[], errors: string[] }}
 */
export function parseActuators(text) {
  const actuators = [];
  const errors = [];
  const seen = new Set();
  const entries = String(text ?? '')
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const equal = entry.indexOf('=');
    if (equal === -1) {
      errors.push(`"${entry}": expected "Name = kind PROTOCOL address"`);
      continue;
    }
    const name = cleanName(entry.slice(0, equal));
    const [kindRaw, protocolRaw, addressRaw, ...rest] = entry
      .slice(equal + 1)
      .trim()
      .split(/\s+/);
    const kind = String(kindRaw ?? '').toLowerCase();
    const protocol = String(protocolRaw ?? '').toUpperCase();
    try {
      if (!name) throw new Error('a name is required before "="');
      if (!ACTUATOR_KINDS.includes(kind)) {
        throw new Error(`unknown kind "${kindRaw ?? ''}" (${ACTUATOR_KINDS.join(', ')})`);
      }
      if (!SEND_PROTOCOLS.includes(protocol)) {
        throw new Error(`protocol "${protocolRaw ?? ''}" cannot transmit`);
      }
      const address = parseAddress(protocol, addressRaw);
      const options = {};
      for (const option of rest) {
        const [key, value] = option.split('=');
        if (!OPTION_KEYS.includes(key?.toLowerCase()) || value === undefined) {
          throw new Error(`unknown option "${option}" (qualifier=n, burst=n)`);
        }
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 255) {
          throw new Error(`invalid ${key} "${value}" (0 to 255)`);
        }
        options[key.toLowerCase()] = n;
      }
      // The external id is built from the protocol and the address: the same
      // pair twice would be one device in Gladys.
      const platformId = `${protocol.toLowerCase()}-${addressKey(address)}`;
      if (seen.has(platformId)) {
        throw new Error(`${protocol} ${addressRaw} is declared twice`);
      }
      seen.add(platformId);
      actuators.push({ name, kind, protocol, address, platformId, ...options });
    } catch (err) {
      errors.push(`"${entry}": ${err.message}`);
    }
  }
  return { actuators, errors };
}

/** One `actuators` entry, written back in the same format. */
export function formatActuator({ name, kind, protocol, address, qualifier, burst }) {
  const parts = [kind, protocol, address.x10 ?? String(address.id)];
  if (qualifier !== undefined) parts.push(`qualifier=${qualifier}`);
  if (burst !== undefined) parts.push(`burst=${burst}`);
  return `${cleanName(name)} = ${parts.join(' ')}`;
}

/**
 * Parse the `detector_kinds` field into platform id -> kind.
 * @returns {{ kinds: Map<string, string>, errors: string[] }}
 */
export function parseDetectorKinds(text) {
  const kinds = new Map();
  const errors = [];
  const entries = String(text ?? '')
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const match = entry.match(/^([A-Za-z0-9]+)\s+([0-9]+)\s*=\s*([a-z]+)$/i);
    if (!match) {
      errors.push(`"${entry}": expected "PROTOCOL id = kind"`);
      continue;
    }
    const kind = match[3].toLowerCase();
    if (!DETECTOR_KINDS.includes(kind)) {
      errors.push(`"${entry}": unknown kind "${match[3]}" (${DETECTOR_KINDS.join(', ')})`);
      continue;
    }
    kinds.set(`${match[1].toLowerCase()}-${match[2]}`, kind);
  }
  return { kinds, errors };
}

/**
 * Merge the user config with the defaults and parse the text fields.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const receivers = Array.isArray(raw.receiver_protocols)
    ? raw.receiver_protocols.filter((p) => RECEIVE_PROTOCOLS.includes(p))
    : [];
  const actuators = parseActuators(raw.actuators ?? DEFAULT_CONFIG.actuators);
  const detectorKinds = parseDetectorKinds(raw.detector_kinds ?? DEFAULT_CONFIG.detector_kinds);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    host: String(raw.host ?? DEFAULT_CONFIG.host).trim(),
    port: clampInt(raw.port, DEFAULT_CONFIG.port, 1, 65535),
    receiver_protocols: receivers,
    jamming_threshold: clampInt(raw.jamming_threshold, DEFAULT_CONFIG.jamming_threshold, 0, 10),
    min_quality: clampInt(raw.min_quality, DEFAULT_CONFIG.min_quality, 0, 10),
    oregon_identity: raw.oregon_identity === 'channel' ? 'channel' : 'address',
    actuators: String(raw.actuators ?? DEFAULT_CONFIG.actuators),
    detector_kinds: String(raw.detector_kinds ?? DEFAULT_CONFIG.detector_kinds),
    // Parsed forms, used by the code.
    actuatorList: actuators.actuators,
    detectorKinds: detectorKinds.kinds,
    configErrors: [...actuators.errors, ...detectorKinds.errors],
  };
}
