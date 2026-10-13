// -----------------------------------------------------------------------------
// Entry point of the RFPlayer integration.
//
// Role of this file: wire the SDK to the runtime (src/service.js). It holds NO
// radio logic:
//   1. it instantiates the SDK (connection, auth, reconnection: handled for you),
//      the link to the dongle and the registry of emitters heard;
//   2. it registers the event handlers BEFORE connect();
//   3. it connects, applies the configuration and starts the link.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { RfPlayerLink } from './src/rfplayer/connection.js';
import { HeardRegistry } from './src/rfplayer/heard.js';
import { RfPlayerService } from './src/service.js';
import { MANIFEST_ACTIONS } from './src/capabilities/actions.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import { buildWidget, RFPLAYER_WIDGET, widgetAction } from './src/capabilities/widget.js';

// A rejected promise nobody awaits (a timer callback, a fire-and-forget
// publication) would terminate Node. Log it and keep the radio running: each
// of those paths already reports its own failures.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

const gladys = new GladysIntegration();
const link = new RfPlayerLink();
const heard = new HeardRegistry();
const service = new RfPlayerService({
  gladys,
  link,
  heard,
  options: { widgetKeys: [RFPLAYER_WIDGET] },
});

const safely = (label, task) =>
  task().catch((err) => logger.error(`${label} failed: ${err.message}`));

// --- The dongle --------------------------------------------------------------
link.on('ready', (info) => safely('Link ready', () => service.onLinkReady(info)));
link.on('down', () => safely('Link down', () => service.onLinkDown()));
link.on('frame', (frame) => safely('Frame handling', () => service.handleFrame(frame)));
link.on('invalid', ({ text, reason }) => {
  heard.recordIgnored();
  logger.debug(`Unreadable line (${reason}): ${String(text).slice(0, 120)}`);
});

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing the heard and declared devices');
  await service.publishDevices();
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  // A throw acks the command as failed: Gladys shows the error.
  await service.onSetValue(device, feature, value);
});

// --- Devices created by the user ---------------------------------------------
// Gladys drops the states of a device that does not exist yet: publish the
// last values heard as soon as it does.
gladys.onDeviceCreated((device) =>
  safely('Device creation', () => service.onDeviceCreated(device)),
);

// --- Manifest actions: buttons in the Configuration screen -------------------
for (const [key, handler] of Object.entries(MANIFEST_ACTIONS)) {
  gladys.onAction(key, (fields) => handler(service, fields ?? {}));
}

// --- Scene actions (Gladys 5.1+) ----------------------------------------------
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(service, fields ?? {}));
}

// --- Dashboard widget (Gladys 5.1+) -------------------------------------------
gladys.onWidgetGet(RFPLAYER_WIDGET, async ({ settings }) => buildWidget(service, { settings }));
gladys.onWidgetAction(RFPLAYER_WIDGET, (actionKey) => widgetAction(service, actionKey));

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  await service.applyConfig(newConfig);
});

// --- Connection lifecycle with Gladys ------------------------------------------
gladys.on('connected', async () => {
  try {
    await service.applyConfig(await gladys.getConfig());
    link.start();
    await service.publishTransports();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Protokolle der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await service.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the RFPlayer integration...');
await heard.load();
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
