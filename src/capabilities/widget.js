// -----------------------------------------------------------------------------
// Dashboard widget (Gladys 5.1+): the RFPlayer at a glance.
//
// Is the dongle connected, what does it hear, is somebody jamming the radio,
// and the last emitters heard — with a badge telling which ones are already
// devices in Gladys. Its one button PINGs the dongle.
//
// The content is declarative (the core renders it, no HTML): status rows,
// tiles, a card list and buttons. Texts are `{ en, fr }`, picked by the core.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { HEARD_BLUEPRINTS } from '../devices/index.js';
import { isCreated } from '../devices/helpers.js';

/** Key of the manifest widget. Never renamed: dashboards store it. */
export const RFPLAYER_WIDGET = 'rfplayer';

export const WIDGET_ACTIONS = { PING: 'ping' };

export const DEFAULT_EMITTERS = 5;
const MAX_EMITTERS = 8;

export const DOCS_URL = 'https://github.com/prohand/gladys-rfplayer/blob/main/docs/en.md';

const KIND_LABELS = {
  sensor: { en: 'sensor', fr: 'capteur' },
  detector: { en: 'detector', fr: 'détecteur' },
  remote: { en: 'remote', fr: 'télécommande' },
  other: { en: 'not used', fr: 'non utilisé' },
};

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "12 s ago" / "il y a 12 s". */
export function describeAge(at, now) {
  if (at === null || at === undefined) return { en: 'never', fr: 'jamais' };
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  let amount;
  if (seconds < 60) amount = `${seconds} s`;
  else if (seconds < 3600) amount = `${Math.round(seconds / 60)} min`;
  else if (seconds < 86_400) amount = `${Math.round(seconds / 3600)} h`;
  else amount = `${Math.round(seconds / 86_400)} d`;
  return { en: `${amount} ago`, fr: `il y a ${amount.replace(' d', ' j')}` };
}

function emitterItem(gladys, entry, now) {
  const blueprint = HEARD_BLUEPRINTS[entry.kind];
  const created = blueprint ? isCreated(gladys, blueprint.ids(gladys, entry).device) : false;
  const kind = KIND_LABELS[entry.kind] ?? KIND_LABELS.other;
  const what = entry.model ?? entry.lastOrder ?? '';
  const age = describeAge(entry.lastSeen, now);
  const quality = entry.quality === null || entry.quality === undefined ? '?' : entry.quality;
  return {
    title: clip(`${entry.protocol} ${entry.address ?? entry.platformId}`, 60),
    subtitle: {
      en: clip([kind.en, what].filter(Boolean).join(' · '), 60),
      fr: clip([kind.fr, what].filter(Boolean).join(' · '), 60),
    },
    date: new Date(entry.lastSeen).toISOString(),
    badge: created
      ? { text: { en: 'in Gladys', fr: 'dans Gladys' }, color: WIDGET_COLORS.SUCCESS }
      : blueprint
        ? { text: { en: 'to create', fr: 'à créer' }, color: WIDGET_COLORS.NEUTRAL }
        : { text: { en: 'ignored', fr: 'ignoré' }, color: WIDGET_COLORS.NEUTRAL },
    description: {
      en: `Heard ${age.en}, ${entry.frames} frame(s), quality ${quality}/10.`,
      fr: `Entendu ${age.fr}, ${entry.frames} trame(s), qualité ${quality}/10.`,
    },
  };
}

function emittersShown(settings) {
  const n = Number(settings?.emitters);
  if (settings?.emitters === undefined || settings?.emitters === '' || !Number.isFinite(n)) {
    return DEFAULT_EMITTERS;
  }
  return Math.max(0, Math.min(MAX_EMITTERS, Math.round(n)));
}

/**
 * The content of the `rfplayer` widget.
 * @param {import('../service.js').RfPlayerService} service
 * @param {{ settings?: object, now?: number }} [request]
 */
export function buildWidget(service, { settings = {}, now = service.now() } = {}) {
  const { link, heard, config, gladys } = service;
  const components = [];

  if (!config.host) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: 'No bridge address: set it in the configuration.',
        fr: "Pas d'adresse de passerelle : renseignez-la dans la configuration.",
      },
    });
  } else if (config.configErrors.length > 0) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: `${config.configErrors.length} configuration error(s): see Test the connection.`,
        fr: `${config.configErrors.length} erreur(s) de configuration : voir Tester la connexion.`,
      },
    });
  }

  const jamming = heard.jamming?.active === true;
  const dongle = [link.info.model, link.info.firmware && `v${link.info.firmware}`]
    .filter(Boolean)
    .join(' · ');
  components.push({
    type: 'status',
    items: [
      {
        label: { en: 'Dongle', fr: 'Clé' },
        icon: 'radio',
        value: link.ready
          ? { en: 'Connected', fr: 'Connectée' }
          : { en: 'Disconnected', fr: 'Déconnectée' },
        color: link.ready ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
      },
      {
        label: { en: 'Bridge', fr: 'Passerelle' },
        icon: 'server',
        value: clip(config.host ? `${config.host}:${config.port}` : '—', 40),
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: { en: 'Model', fr: 'Modèle' },
        icon: 'cpu',
        value: clip(dongle || '—', 40),
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: { en: 'Last frame', fr: 'Dernière trame' },
        icon: 'clock',
        value: describeAge(heard.lastFrameAt, now),
        color: WIDGET_COLORS.INFO,
      },
      {
        label: { en: 'Frames ignored', fr: 'Trames ignorées' },
        icon: 'filter',
        value: heard.ignored,
        color: heard.ignored > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      },
      {
        label: { en: 'Jamming', fr: 'Brouillage' },
        icon: 'shield',
        value: jamming ? { en: 'DETECTED', fr: 'DÉTECTÉ' } : { en: 'None', fr: 'Aucun' },
        color: jamming ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
      },
    ],
  });

  const entries = heard.list();
  components.push(
    {
      type: 'value',
      label: { en: 'Emitters heard', fr: 'Émetteurs entendus' },
      icon: 'radio',
      value: entries.length,
    },
    {
      type: 'value',
      label: { en: 'Frames received', fr: 'Trames reçues' },
      icon: 'activity',
      value: heard.frames,
    },
    {
      type: 'value',
      label: { en: 'Orders sent', fr: 'Ordres envoyés' },
      icon: 'send',
      value: service.ordersSent,
    },
  );

  const shown = emittersShown(settings);
  if (shown > 0 && entries.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: entries.slice(0, shown).map((entry) => emitterItem(gladys, entry, now)),
    });
  }

  components.push(
    {
      type: 'button',
      label: { en: 'Test the dongle', fr: 'Tester la clé' },
      icon: 'zap',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.PING },
    },
    {
      type: 'button',
      label: { en: 'Documentation', fr: 'Documentation' },
      icon: 'book-open',
      style: 'secondary',
      link: { url: DOCS_URL },
    },
  );

  // Frames refresh it (see RfPlayerService.refreshWidgets): the TTL is a safety net.
  return { ttl_seconds: 120, components };
}

/** A tapped widget button: resolves the toast. */
export async function widgetAction(service, actionKey) {
  if (actionKey !== WIDGET_ACTIONS.PING) {
    throw new Error(`Unknown widget action: ${actionKey}`);
  }
  if (!service.link.ready) {
    return { en: 'The dongle is not connected.', fr: "La clé n'est pas connectée." };
  }
  const ms = await service.link.ping();
  return { en: `The dongle answered in ${ms} ms.`, fr: `La clé a répondu en ${ms} ms.` };
}
