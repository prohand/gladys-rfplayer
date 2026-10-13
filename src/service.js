// -----------------------------------------------------------------------------
// The integration's runtime: what happens when the dongle speaks, when Gladys
// asks for something, when the configuration changes.
//
// index.js only wires SDK handlers to this class; keeping the logic here lets
// the tests drive it with a fake Gladys and a fake link (no socket, no Gladys).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { decodeFrame } from './rfplayer/frames.js';
import {
  applyEvent,
  buildDiscoveredDevices,
  buildTransportBatches,
  findActuator,
  replayStates,
} from './devices/index.js';

const logger = createLogger({ name: 'rfplayer' });

// A remote sends each press several times on the air; the dongle reports
// every copy. Copies of the same order closer than this are one press.
const REPEAT_WINDOW_MS = 1500;

export class RfPlayerService {
  /**
   * @param {object} deps
   * @param {object} deps.gladys the SDK instance (or a fake)
   * @param {object} deps.link   an RfPlayerLink (or a fake)
   * @param {object} deps.heard  a HeardRegistry
   * @param {object} [deps.options]
   */
  constructor({ gladys, link, heard, options = {} }) {
    this.gladys = gladys;
    this.link = link;
    this.heard = heard;
    this.now = options.now ?? Date.now;
    this.rediscoverDelayMs = options.rediscoverDelayMs ?? 5_000;
    this.widgetRefreshMs = options.widgetRefreshMs ?? 10_000;
    this.widgetKeys = options.widgetKeys ?? [];
    this.rawConfig = {};
    this.config = normalizeConfig();
    this.lastPresses = new Map();
    this.resetTimers = new Map();
    this.rediscoverTimer = null;
    this.widgetTimer = null;
    this.ordersSent = 0;
    this.lastOrder = null;
  }

  // --- Configuration ---------------------------------------------------------

  /** Apply a raw configuration (from getConfig or onConfigUpdated). */
  async applyConfig(raw = {}) {
    this.rawConfig = { ...raw };
    this.config = normalizeConfig(raw);
    for (const error of this.config.configErrors) {
      logger.warn(`Configuration: ${error}`);
    }
    this.link.configure(this.config);
    await this.publishDevices();
    await this.reportStatus();
    this.refreshWidgets();
  }

  // --- Publication -----------------------------------------------------------

  async publishDevices() {
    clearTimeout(this.rediscoverTimer);
    this.rediscoverTimer = null;
    await this.gladys.publishDiscoveredDevices(
      buildDiscoveredDevices(this.gladys, this.config, this.heard),
    );
  }

  /** Publish discovery again soon: many new emitters heard in a row cost one call. */
  scheduleRediscover() {
    if (this.rediscoverTimer) return;
    this.rediscoverTimer = setTimeout(() => {
      this.rediscoverTimer = null;
      this.publishDevices().catch((err) =>
        logger.warn(`Could not publish the discovered devices: ${err.message}`),
      );
    }, this.rediscoverDelayMs);
    this.rediscoverTimer.unref?.();
  }

  async publishTransports() {
    for (const batch of buildTransportBatches(this.gladys, this.link.ready)) {
      if (batch.length > 0) {
        await this.gladys.publishTransports(batch);
      }
    }
  }

  /** The connection status shown in the Configuration screen. */
  async reportStatus() {
    let message;
    if (this.link.ready) {
      await this.gladys.setConnectionStatus(true);
      return;
    }
    if (!this.config.host) {
      message = {
        en: 'Enter the address of the serial-to-TCP bridge of your RFPlayer.',
        fr: "Renseignez l'adresse de la passerelle série-TCP de votre RFPlayer.",
        de: 'Gib die Adresse der Seriell-TCP-Bridge deines RFPlayer ein.',
        es: 'Indique la dirección del puente serie-TCP de su RFPlayer.',
      };
    } else {
      const reason = this.link.lastError ?? 'connecting';
      message = {
        en: `RFPlayer unreachable at ${this.config.host}:${this.config.port} (${reason}).`,
        fr: `RFPlayer injoignable à ${this.config.host}:${this.config.port} (${reason}).`,
        de: `RFPlayer unter ${this.config.host}:${this.config.port} nicht erreichbar (${reason}).`,
        es: `RFPlayer inaccesible en ${this.config.host}:${this.config.port} (${reason}).`,
      };
    }
    await this.gladys.setConnectionStatus(false, message);
  }

  /** Nudge the dashboard widgets (the core accepts one nudge per 10 s per widget). */
  refreshWidgets({ soon = false } = {}) {
    if (!soon) {
      for (const key of this.widgetKeys) this.gladys.requestWidgetRefresh(key);
      return;
    }
    if (this.widgetTimer) return;
    this.widgetTimer = setTimeout(() => {
      this.widgetTimer = null;
      this.refreshWidgets();
    }, this.widgetRefreshMs);
    this.widgetTimer.unref?.();
  }

  // --- Link lifecycle --------------------------------------------------------

  async onLinkReady(info) {
    this.heard.setGateway(info);
    await this.publishDevices();
    await this.publishTransports();
    await this.reportStatus();
    this.refreshWidgets();
  }

  async onLinkDown() {
    await this.publishTransports();
    await this.reportStatus();
    this.refreshWidgets();
  }

  // --- Incoming radio frames -------------------------------------------------

  async handleFrame(frame) {
    const event = decodeFrame(frame, this.config);
    if (!event) {
      this.heard.recordIgnored();
      return;
    }
    // Jamming frames carry irrelevant RF figures (API spec): never filter them.
    if (
      event.kind !== 'jamming' &&
      event.quality !== null &&
      event.quality < this.config.min_quality
    ) {
      logger.debug(`Frame below the quality threshold: ${event.protocol} ${event.platformId}`);
      this.heard.recordIgnored();
      return;
    }
    if (this.isRepeat(event)) {
      this.heard.record(event);
      return;
    }
    logger.debug(`Heard ${event.kind} ${event.protocol} ${event.platformId}`);

    const { states, sceneEvents, rediscover } = applyEvent(
      this.gladys,
      this.config,
      this.heard,
      event,
    );
    if (rediscover) {
      this.scheduleRediscover();
    }
    if (states.length > 0) {
      await this.gladys.publishStates(
        states.map((s) => ({ device_feature_external_id: s.external_id, state: s.value })),
      );
      for (const state of states) {
        this.armReset(state);
      }
    }
    for (const { key, data } of sceneEvents) {
      await this.gladys
        .publishSceneEvent(key, data)
        .catch((err) => logger.warn(`Scene event ${key} refused: ${err.message}`));
    }
    this.refreshWidgets({ soon: true });
  }

  isRepeat(event) {
    if (event.kind !== 'remote') return false;
    const key = `${event.platformId}|${event.order}`;
    const now = this.now();
    const last = this.lastPresses.get(key);
    this.lastPresses.set(key, now);
    if (this.lastPresses.size > 500) {
      this.lastPresses.delete(this.lastPresses.keys().next().value);
    }
    return last !== undefined && now - last < REPEAT_WINDOW_MS;
  }

  /** Motion / smoke detectors never send "it stopped": fall back to 0 ourselves. */
  armReset(state) {
    const existing = this.resetTimers.get(state.external_id);
    if (existing) {
      clearTimeout(existing);
      this.resetTimers.delete(state.external_id);
    }
    if (!state.resetAfterMs || state.value !== 1) {
      return;
    }
    const timer = setTimeout(() => {
      this.resetTimers.delete(state.external_id);
      this.heard.rememberState(state.kind, state.platformId, state.featureKey, 0);
      this.gladys
        .publishState(state.external_id, 0)
        .catch((err) => logger.warn(`Could not reset ${state.external_id}: ${err.message}`));
    }, state.resetAfterMs);
    timer.unref?.();
    this.resetTimers.set(state.external_id, timer);
  }

  // --- Gladys requests -------------------------------------------------------

  async onSetValue(device, feature, value) {
    const found = findActuator(this.gladys, this.config, device.external_id);
    if (!found) {
      // Heard devices are read-only: a command reaching one is a bug or a
      // device whose actuator line was removed from the configuration.
      throw new Error(`${device.external_id} is not a declared actuator`);
    }
    await found.blueprint.onSetValue(this.gladys, {
      actuator: found.actuator,
      feature,
      value,
      link: this.link,
    });
    this.noteOrder(`${found.actuator.name}: ${value}`);
  }

  /** Remember the last order sent, for the widget. */
  noteOrder(text) {
    this.ordersSent += 1;
    this.lastOrder = { text, at: this.now() };
  }

  /** A device was just created: publish what is already known of it. */
  async onDeviceCreated(device) {
    const states = replayStates(this.gladys, this.heard, device.external_id);
    if (states.length > 0) {
      await this.gladys.publishStates(states);
    }
    await this.publishTransports();
  }

  // --- Shutdown --------------------------------------------------------------

  async stop() {
    clearTimeout(this.rediscoverTimer);
    clearTimeout(this.widgetTimer);
    for (const timer of this.resetTimers.values()) clearTimeout(timer);
    this.resetTimers.clear();
    this.link.stop();
    await this.heard.save();
  }
}
