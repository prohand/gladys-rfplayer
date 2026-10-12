// -----------------------------------------------------------------------------
// Emitters heard on the air, remembered.
//
// Radio devices are not enumerated: they exist for the integration the moment
// one of their frames is heard. This registry is what discovery lists, what
// the widget shows, and what lets a device the user creates later get its
// last known values right away.
//
// It is bounded (the neighbours' weather probes are heard too) and saved to
// /data — the only writable path of the container — so a restart does not
// empty the Discovery screen until every probe has spoken again. A failed
// save is logged, never fatal: the registry is a cache.
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'heard' });

export const DEFAULT_HEARD_FILE = '/data/rfplayer-heard.json';
const FILE_VERSION = 1;
const MAX_EMITTERS = 150;
const SAVE_DELAY_MS = 30_000;

export class HeardRegistry {
  /**
   * @param {object} [options]
   * @param {string|null} [options.file] where to persist; null keeps it in memory
   * @param {number} [options.max]
   * @param {() => number} [options.now]
   */
  constructor({ file = DEFAULT_HEARD_FILE, max = MAX_EMITTERS, now = Date.now } = {}) {
    this.file = file;
    this.max = max;
    this.now = now;
    this.entries = new Map();
    this.gateway = null;
    this.frames = 0;
    this.ignored = 0;
    this.lastFrameAt = null;
    this.jamming = null;
    this.saveTimer = null;
  }

  static key(kind, platformId) {
    return `${kind}:${platformId}`;
  }

  /**
   * Record a decoded event (see frames.js).
   * @returns {{ entry: object|null, isNew: boolean, shapeChanged: boolean }}
   *   `shapeChanged`: the device built from the entry gained a feature (a new
   *   measure, a battery flag…), so discovery must be published again.
   */
  record(event) {
    this.frames += 1;
    this.lastFrameAt = this.now();
    if (event.kind === 'jamming') {
      this.jamming = { active: event.active, at: this.lastFrameAt };
      this.scheduleSave();
      return { entry: null, isNew: false, shapeChanged: false };
    }
    const key = HeardRegistry.key(event.kind, event.platformId);
    let entry = this.entries.get(key);
    const isNew = !entry;
    if (!entry) {
      entry = {
        kind: event.kind,
        platformId: event.platformId,
        protocol: event.protocol,
        address: event.address ?? null,
        model: event.model ?? null,
        channel: event.channel ?? null,
        firstSeen: this.lastFrameAt,
        frames: 0,
        measures: [],
        battery: false,
        smoke: false,
        rts: false,
        lastOrder: null,
        states: {},
      };
      this.entries.set(key, entry);
    }
    entry.frames += 1;
    entry.lastSeen = this.lastFrameAt;
    if (isNew) {
      // After lastSeen is set: the newcomer must not be the one evicted.
      this.evict();
    }
    entry.quality = event.quality ?? null;
    entry.rfLevel = event.rfLevel ?? null;
    if (event.order) entry.lastOrder = event.order;

    let shapeChanged = isNew;
    const flag = (name, value) => {
      if (value && !entry[name]) {
        entry[name] = true;
        shapeChanged = true;
      }
    };
    flag('smoke', event.smoke);
    flag('rts', event.kind === 'remote' && event.protocol === 'RTS' && !event.portal);
    flag('battery', event.lowBattery !== null && event.lowBattery !== undefined);
    for (const measure of event.measures ?? []) {
      if (!entry.measures.includes(measure.type)) {
        entry.measures.push(measure.type);
        shapeChanged = true;
      }
    }
    this.scheduleSave();
    return { entry, isNew, shapeChanged };
  }

  /** Count a frame that was decoded but dropped (bad quality, unusable). */
  recordIgnored() {
    this.frames += 1;
    this.ignored += 1;
    this.lastFrameAt = this.now();
  }

  /** Remember the last value published for a feature of an emitter. */
  rememberState(kind, platformId, featureKey, value) {
    const entry = this.entries.get(HeardRegistry.key(kind, platformId));
    if (entry) {
      entry.states[featureKey] = value;
    }
  }

  get(kind, platformId) {
    return this.entries.get(HeardRegistry.key(kind, platformId)) ?? null;
  }

  /** Every emitter, most recently heard first. */
  list() {
    return [...this.entries.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  setGateway(info) {
    if (info?.mac) {
      this.gateway = { ...info };
      this.scheduleSave();
    }
  }

  evict() {
    if (this.entries.size <= this.max) {
      return;
    }
    const oldest = this.list().slice(this.max);
    for (const entry of oldest) {
      this.entries.delete(HeardRegistry.key(entry.kind, entry.platformId));
    }
  }

  async load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data?.version !== FILE_VERSION) return;
      for (const entry of data.entries ?? []) {
        if (entry?.kind && entry?.platformId) {
          this.entries.set(HeardRegistry.key(entry.kind, entry.platformId), {
            measures: [],
            states: {},
            ...entry,
          });
        }
      }
      this.gateway = data.gateway ?? null;
      this.evict();
      logger.info(`${this.entries.size} emitter(s) remembered from the last run`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Could not read ${this.file}: ${err.message}`);
      }
    }
  }

  scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch(() => {});
    }, SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  async save() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const data = { version: FILE_VERSION, gateway: this.gateway, entries: this.list() };
    const tmp = `${this.file}.tmp`;
    try {
      // Write then rename: a container stopped mid-write keeps the old file.
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, this.file);
    } catch (err) {
      logger.warn(`Could not save ${this.file}: ${err.message}`);
    }
  }
}
