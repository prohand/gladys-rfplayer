// -----------------------------------------------------------------------------
// The link to the RFPlayer, over TCP.
//
// Why TCP and not the USB port: the integration runs in a sandboxed container
// that is never given a /dev/tty* device (the Gladys hardware grants only know
// coral, gpu and video). The dongle stays plugged into the Gladys host — or
// any machine — and a serial-to-TCP bridge exposes it on the LAN: ser2net,
// socat, an ESP-Link… The bytes on the socket are exactly the bytes of the
// serial port, 115200 bauds, so nothing else changes.
//
// This class owns:
//   - the socket and its reconnection (exponential backoff, for life);
//   - the line splitting (terminators `\r`, `\n` or `\0`);
//   - ONE queue for everything written: the dongle has one radio, and the API
//     says it stops its RF activity while it reads a command, so orders go out
//     one at a time with a short gap between them;
//   - the handshake (HELLO, then the init commands) and a PING keep-alive: a
//     bridge keeps its TCP port open when the dongle is unplugged, only a
//     missing PONG tells.
//
// Events: `ready` (info), `down` (reason), `frame` (frame object),
// `invalid` ({ text, reason }), `trace` (text).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { createLogger } from '@gladysassistant/integration-sdk';
import {
  initCommands,
  isHelloAnswer,
  isPongAnswer,
  isSystemStatusAnswer,
  parseHello,
  parseLine,
  parseSystemStatus,
  toLine,
} from './protocol.js';

const logger = createLogger({ name: 'rfplayer-link' });

const DEFAULTS = {
  connectTimeoutMs: 10_000,
  requestTimeoutMs: 5_000,
  // The API gives no figure; a Somfy RTS frame lasts ~150 ms and LBT may hold
  // it a little: 300 ms keeps two orders from stepping on each other.
  commandGapMs: 300,
  pingIntervalMs: 60_000,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 60_000,
  maxLineLength: 8_192,
};

export class RfPlayerLink extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {(opts: { host: string, port: number }) => import('node:net').Socket} [options.createSocket]
   */
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULTS, ...options };
    this.createSocket = options.createSocket ?? ((opts) => net.createConnection(opts));
    this.target = null;
    this.config = { receiver_protocols: [], jamming_threshold: 7 };
    this.socket = null;
    this.buffer = '';
    this.ready = false;
    this.running = false;
    this.info = { model: null, firmware: null, mac: null };
    this.lastError = null;
    this.lastPongAt = null;
    this.queue = Promise.resolve();
    this.pending = null;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.generation = 0;
  }

  /** `host:port`, for messages. */
  get address() {
    return this.target ? `${this.target.host}:${this.target.port}` : null;
  }

  /**
   * Apply the configuration. A new address restarts the link; new receiver
   * settings are pushed to a dongle already connected.
   */
  configure({ host, port, receiver_protocols, jamming_threshold }) {
    this.config = { receiver_protocols, jamming_threshold };
    const next = host ? { host, port } : null;
    const changed = next?.host !== this.target?.host || next?.port !== this.target?.port;
    this.target = next;
    if (changed && this.running) {
      this.restart();
      return;
    }
    if (this.ready) {
      this.sendInit().catch((err) => logger.warn(`Could not apply the settings: ${err.message}`));
    }
  }

  start() {
    this.running = true;
    if (!this.socket) {
      this.open();
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardown('stopped');
  }

  restart() {
    this.teardown('configuration changed');
    this.attempt = 0;
    this.open();
  }

  open() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (!this.running) {
      return;
    }
    if (!this.target) {
      this.lastError = 'no address configured';
      return;
    }
    const generation = ++this.generation;
    const { host, port } = this.target;
    logger.info(`Connecting to the RFPlayer bridge at ${host}:${port}...`);
    let socket;
    try {
      socket = this.createSocket({ host, port });
    } catch (err) {
      this.onSocketGone(generation, err.message);
      return;
    }
    this.socket = socket;
    this.buffer = '';
    socket.setEncoding?.('latin1');
    socket.setNoDelay?.(true);
    socket.setKeepAlive?.(true, 30_000);
    socket.setTimeout?.(this.options.connectTimeoutMs);
    socket.once('connect', () => {
      if (generation !== this.generation) return;
      socket.setTimeout?.(0);
      this.handshake(generation).catch((err) => {
        logger.warn(`The RFPlayer did not answer: ${err.message}`);
        this.teardown(err.message);
        this.scheduleReconnect();
      });
    });
    socket.on('data', (chunk) => {
      if (generation === this.generation) this.onData(String(chunk));
    });
    socket.on('timeout', () => {
      if (generation === this.generation) socket.destroy(new Error('connection timed out'));
    });
    socket.on('error', (err) => {
      if (generation === this.generation) this.lastError = err.message;
    });
    socket.on('close', () => this.onSocketGone(generation, this.lastError ?? 'connection closed'));
  }

  onSocketGone(generation, reason) {
    if (generation !== this.generation) {
      return;
    }
    this.teardown(reason);
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (!this.running || this.reconnectTimer || !this.target) {
      return;
    }
    const delay = Math.min(
      this.options.reconnectBaseMs * 2 ** this.attempt,
      this.options.reconnectMaxMs,
    );
    this.attempt += 1;
    logger.info(`Reconnecting to the RFPlayer in ${Math.round(delay / 1000)} s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /** Drop the socket and everything waiting on it. */
  teardown(reason) {
    this.generation += 1;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners('data');
      socket.on('error', () => {});
      socket.destroy();
    }
    if (this.pending) {
      this.pending.reject(new Error(`Link down: ${reason}`));
      this.pending = null;
    }
    this.queue = Promise.resolve();
    if (reason !== 'stopped') {
      this.lastError = reason;
    }
    if (this.ready) {
      this.ready = false;
      if (reason === 'stopped') {
        logger.info('RFPlayer link closed');
      } else {
        logger.warn(`RFPlayer link down: ${reason}`);
      }
      this.emit('down', reason);
    }
  }

  async handshake(generation) {
    const hello = await this.request('HELLO', isHelloAnswer);
    if (generation !== this.generation) return;
    this.info = parseHello(hello);
    await this.sendInit();
    if (generation !== this.generation) return;
    this.ready = true;
    this.attempt = 0;
    this.lastError = null;
    this.lastPongAt = Date.now();
    logger.info(
      `RFPlayer ready: ${this.info.model ?? 'unknown model'}, firmware ${this.info.firmware ?? '?'}`,
    );
    this.pingTimer = setInterval(() => this.keepAlive(), this.options.pingIntervalMs);
    this.emit('ready', this.info);
  }

  async sendInit() {
    for (const command of initCommands(this.config)) {
      await this.send(command);
    }
  }

  async keepAlive() {
    try {
      await this.ping();
    } catch (err) {
      logger.warn(`No PONG from the RFPlayer (${err.message}): reconnecting`);
      this.teardown('no answer to PING');
      this.scheduleReconnect();
    }
  }

  /** PING the dongle; resolves the round trip in ms. */
  async ping() {
    const started = Date.now();
    await this.request('PING', isPongAnswer);
    this.lastPongAt = Date.now();
    return this.lastPongAt - started;
  }

  /** `STATUS SYSTEM JSON`, flattened (see parseSystemStatus). */
  async systemStatus() {
    return parseSystemStatus(await this.request('STATUS SYSTEM JSON', isSystemStatusAnswer));
  }

  onData(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/[\r\n\0]+/);
    this.buffer = lines.pop() ?? '';
    if (this.buffer.length > this.options.maxLineLength) {
      // A bridge left in another mode (FORMAT BINARY) never sends a
      // terminator: do not let the buffer grow for ever.
      this.emit('invalid', { text: this.buffer.slice(0, 80), reason: 'line too long' });
      this.buffer = '';
    }
    for (const line of lines) {
      this.onLine(line);
    }
  }

  onLine(line) {
    const parsed = parseLine(line);
    if (!parsed) {
      return;
    }
    if (parsed.type === 'answer') {
      if (this.pending?.match(parsed.text)) {
        const { resolve } = this.pending;
        this.pending = null;
        resolve(parsed.text);
      } else {
        logger.debug(`Unsolicited answer: ${parsed.text.slice(0, 120)}`);
      }
      return;
    }
    if (parsed.type === 'frame') {
      this.emit('frame', parsed.frame);
      return;
    }
    this.emit(parsed.type, parsed.type === 'trace' ? parsed.text : parsed);
  }

  /**
   * Send a radio order (see buildOrder). Refused while the handshake has not
   * succeeded: an order written to a bridge whose dongle is unplugged would
   * vanish without a trace.
   */
  async order(command) {
    if (!this.ready) {
      throw new Error(`RFPlayer not connected (${this.lastError ?? 'connecting'})`);
    }
    logger.info(`Radio order: ${command}`);
    await this.send(command);
  }

  /** Queue a write; resolves once it is on the wire and the gap elapsed. */
  send(command) {
    return this.enqueue(async () => {
      this.write(command);
      await sleep(this.options.commandGapMs);
    });
  }

  /** Queue a command that answers; resolves the answer text. */
  request(command, match) {
    return this.enqueue(
      () =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            if (this.pending?.timer === timer) {
              this.pending = null;
            }
            reject(new Error(`no answer to ${command}`));
          }, this.options.requestTimeoutMs);
          this.pending = {
            match,
            timer,
            resolve: (text) => {
              clearTimeout(timer);
              resolve(text);
            },
            reject: (err) => {
              clearTimeout(timer);
              reject(err);
            },
          };
          try {
            this.write(command);
          } catch (err) {
            this.pending.reject(err);
            this.pending = null;
          }
        }),
    );
  }

  enqueue(task) {
    // A task queued on a connection that has since dropped must not reach the
    // next one: an order would go out before its HELLO, long after the user
    // asked for it.
    const generation = this.generation;
    const run = this.queue.then(() => {
      if (!this.socket || generation !== this.generation) {
        throw new Error('RFPlayer not connected');
      }
      return task();
    });
    // The chain itself never rejects: one failed order must not block the
    // next ones.
    this.queue = run.catch(() => {});
    return run;
  }

  write(command) {
    const line = toLine(command);
    logger.debug(`-> ${line.trim()}`);
    this.socket.write(line);
  }
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
