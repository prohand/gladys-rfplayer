// -----------------------------------------------------------------------------
// The RFPlayer ASCII protocol (Ziblue / GCE Electronics RFP1000 API).
//
// Pure functions only: building the command lines sent to the dongle and
// cutting apart the lines it sends back. No socket, no timer — see
// connection.js for the transport.
//
// What the API specification says, and this module relies on:
//   - a command is `ZIA++<command>` terminated by `\r`; the `ZIA++` header is
//     case sensitive, the rest is not;
//   - a `.` separates several commands on one line: user input must never be
//     able to smuggle one in (a scene could otherwise send FACTORYRESET);
//   - HELLO, PING and STATUS are the only commands that answer, with a line
//     starting with `ZIA--`;
//   - once `FORMAT JSON` is sent, every frame heard on the air arrives as a
//     `ZIA33{...}` line (and the built-in repeater is switched off);
//   - an order is `<ACTION> <PROTOCOL> <address> [%dim] [BURST n] [QUALIFIER n]`,
//     the address being `ID n` or the X10 form `A1`…`P16`, in any order.
// -----------------------------------------------------------------------------

/** Protocols the dongle can transmit on (order emission). */
export const SEND_PROTOCOLS = [
  'X10',
  'CHACON',
  'DOMIA',
  'BLYSS',
  'RTS',
  'VISONIC433',
  'VISONIC868',
  'X2D433',
  'X2D868',
  'X2DSHUTTER',
  'X2DELEC',
  'X2DGAS',
  'PARROT',
  'KD101',
  'FS20',
  'EDISIO',
];

/** Protocols the receiver can be told to decode (`RECEIVER` command). */
export const RECEIVE_PROTOCOLS = [
  'X10',
  'RTS',
  'VISONIC',
  'BLYSS',
  'CHACON',
  'OREGONV1',
  'OREGONV2',
  'OREGONV3/OWL',
  'DOMIA',
  'X2D',
  'KD101',
  'PARROT',
  'TIC',
  'FS20',
  'JAMMING',
  'EDISIO',
];

/** Actions an order can carry. */
export const ACTIONS = {
  ON: 'ON',
  OFF: 'OFF',
  DIM: 'DIM',
  ASSOC: 'ASSOC',
  DISSOC: 'DISSOC',
  ALL_ON: 'ALL_ON',
  ALL_OFF: 'ALL_OFF',
  TOGGLE: 'TOGGLE',
};

/** The DIM value that plays the Somfy RTS "my" button (API spec, RTS row). */
export const RTS_MY_LEVEL = 4;

const X10_ADDRESS = /^([A-P])([1-9]|1[0-6])$/i;
const MAX_ID = { KD101: 0xffffffff, PARROT: 254 };
const DEFAULT_MAX_ID = 255;

/**
 * Read an address typed by a user: the X10 form (`A1`…`P16`) or a number.
 * The dongle derives the identifier really sent on the air from its own MAC,
 * so `ID 1` of one RFPlayer is not `ID 1` of another (no neighbour clash).
 *
 * @param {string} protocol one of SEND_PROTOCOLS
 * @param {string|number} raw
 * @returns {{ x10: string } | { id: number }}
 */
export function parseAddress(protocol, raw) {
  const text = String(raw ?? '').trim();
  const x10 = text.match(X10_ADDRESS);
  if (x10 && protocol !== 'KD101') {
    return { x10: `${x10[1].toUpperCase()}${Number(x10[2])}` };
  }
  if (!/^\d+$/.test(text)) {
    throw new Error(`Invalid address "${text}": a number or an X10 address such as A1`);
  }
  const id = Number(text);
  const max = MAX_ID[protocol] ?? DEFAULT_MAX_ID;
  if (id > max) {
    throw new Error(`Invalid address ${id}: ${protocol} accepts 0 to ${max}`);
  }
  return { id };
}

/** `ID 12` or `A1`, as the command interpreter reads it. */
export function formatAddress(address) {
  return address.x10 ?? `ID ${address.id}`;
}

/** A short, stable spelling of an address for external ids: `12`, `a1`. */
export function addressKey(address) {
  return address.x10 ? address.x10.toLowerCase() : String(address.id);
}

function checkByte(name, value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 255) {
    throw new Error(`Invalid ${name} ${value}: 0 to 255`);
  }
  return number;
}

/**
 * Build one radio order, without the `ZIA++` header.
 *
 * @param {object} order
 * @param {string} order.action one of ACTIONS
 * @param {string} order.protocol one of SEND_PROTOCOLS
 * @param {string|number|object} order.address raw address or parseAddress() result
 * @param {number} [order.level] DIM percentage, 0 to 100
 * @param {number} [order.qualifier] protocol option (RTS: 1 = portal)
 * @param {number} [order.burst] frame repetition factor
 * @returns {string} e.g. `DIM RTS ID 1 %4`
 */
export function buildOrder({ action, protocol, address, level, qualifier, burst }) {
  const verb = String(action ?? '').toUpperCase();
  if (!Object.values(ACTIONS).includes(verb)) {
    throw new Error(`Unknown action "${action}"`);
  }
  const proto = String(protocol ?? '').toUpperCase();
  if (!SEND_PROTOCOLS.includes(proto)) {
    throw new Error(`Protocol "${protocol}" cannot transmit`);
  }
  const parsed = typeof address === 'object' && address ? address : parseAddress(proto, address);
  const parts = [verb, proto, formatAddress(parsed)];
  if (verb === ACTIONS.DIM) {
    const percent = Number(level);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new Error(`Invalid DIM level ${level}: 0 to 100`);
    }
    parts.push(`%${percent}`);
  }
  const burstValue = checkByte('burst', burst);
  if (burstValue !== undefined) {
    parts.push(`BURST ${burstValue}`);
  }
  const qualifierValue = checkByte('qualifier', qualifier);
  if (qualifierValue !== undefined) {
    parts.push(`QUALIFIER ${qualifierValue}`);
  }
  return parts.join(' ');
}

// Letters, digits, spaces and the few signs the commands use. No `.` (the
// command separator), no line terminator.
const SAFE_COMMAND = /^[A-Za-z0-9 %+*/_-]+$/;

/**
 * Frame a command for the wire.
 * @param {string} command e.g. `HELLO`, `ON X10 A1`
 * @returns {string} `ZIA++<command>\r`
 */
export function toLine(command) {
  if (!SAFE_COMMAND.test(command)) {
    throw new Error(`Refusing to send an unsafe command: ${JSON.stringify(command)}`);
  }
  return `ZIA++${command}\r`;
}

/**
 * Commands sent once the dongle answered HELLO: JSON frames, the receivers
 * the user wants, the jamming threshold.
 *
 * @param {{ receiver_protocols: string[], jamming_threshold: number }} config
 * @returns {string[]}
 */
export function initCommands(config) {
  const wanted = (config.receiver_protocols ?? []).filter((p) => RECEIVE_PROTOCOLS.includes(p));
  const receiver = wanted.length > 0 ? `RECEIVER - * + ${wanted.join(' ')}` : 'RECEIVER + *';
  return ['FORMAT JSON', receiver, `JAMMING ${config.jamming_threshold}`];
}

/**
 * Classify one line received from the dongle.
 *
 * @param {string} raw
 * @returns {null | { type: 'answer', text: string }
 *   | { type: 'frame', frame: object }
 *   | { type: 'trace', text: string }
 *   | { type: 'invalid', text: string, reason: string }}
 */
export function parseLine(raw) {
  const line = String(raw ?? '');
  // Anything before the header is noise from a half-read frame (the API
  // itself says the receiver strips everything until it sees "ZI").
  const start = line.indexOf('ZIA');
  if (start === -1) {
    return null;
  }
  const header = line.slice(start, start + 5);
  const body = line.slice(start + 5).trim();
  if (header === 'ZIA--') {
    return { type: 'answer', text: body };
  }
  if (header === 'ZIA33') {
    try {
      const json = JSON.parse(body);
      if (!json || typeof json.frame !== 'object' || json.frame === null) {
        return { type: 'invalid', text: body, reason: 'no "frame" object' };
      }
      return { type: 'frame', frame: json.frame };
    } catch (err) {
      return { type: 'invalid', text: body, reason: err.message };
    }
  }
  if (header === 'ZIA55') {
    return { type: 'trace', text: body };
  }
  return { type: 'invalid', text: line.slice(start), reason: `unexpected header ${header}` };
}

/**
 * Read the HELLO answer:
 * `Welcome to Ziblue Dongle RFPLAYER (RFP1000, Firmware V1.12 Mac 0xF6C09FA1)!`
 * The API says the part after "Welcome to Ziblue Dongle" MUST not be matched
 * strictly, so every field is optional.
 */
export function parseHello(text) {
  const model = text.match(/\(\s*([A-Z0-9]+)\s*,/i)?.[1] ?? null;
  const firmware = text.match(/Firmware\s*=?\s*V?([0-9.]+)/i)?.[1] ?? null;
  const mac = text.match(/Mac\s*=?\s*0x([0-9a-f]+)/i)?.[1]?.toLowerCase() ?? null;
  return { model, firmware, mac };
}

/** Is this answer the one HELLO gives? */
export function isHelloAnswer(text) {
  return /Welcome to Ziblue/i.test(text);
}

/** Is this answer the one PING gives? */
export function isPongAnswer(text) {
  return /PONG/i.test(text);
}

/** Is this answer the one `STATUS SYSTEM JSON` gives? */
export function isSystemStatusAnswer(text) {
  return text.startsWith('{') && text.includes('systemStatus');
}

/**
 * Read the `STATUS SYSTEM JSON` answer into a flat object, e.g.
 * `{ Version: '1.17', Mac: '0xFD0CBA71', ... , receiverEnabled: [...] }`.
 */
export function parseSystemStatus(text) {
  const json = JSON.parse(text);
  const out = {};
  for (const item of json?.systemStatus?.info ?? []) {
    if (item && typeof item.n === 'string') {
      out[item.n] = item.v;
    }
    for (const block of ['transmitter', 'receiver', 'repeater']) {
      for (const [state, list] of Object.entries(item?.[block] ?? {})) {
        const key = `${block}${state[0].toUpperCase()}${state.slice(1)}`;
        out[key] = Array.isArray(list?.p) ? list.p : [];
      }
    }
  }
  return out;
}
