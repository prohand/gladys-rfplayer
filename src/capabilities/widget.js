// -----------------------------------------------------------------------------
// Dashboard widget (Gladys 5.1+): the RFPlayer at a glance.
//
// Is the dongle connected, what does it hear, is somebody jamming the radio,
// and the last emitters heard — with a badge telling which ones are already
// devices in Gladys. Its one button PINGs the dongle.
//
// The content is declarative (the core renders it, no HTML): status rows,
// tiles, a card list and buttons. Texts are `{ en, fr, de, es }`, picked by the core.
//
// A second button opens a short form (protocol, address, order, level): the
// `send_order` scene action, from the dashboard — the radio test a user wants
// while pairing a receiver. The form is validated by the core, then the order
// by buildOrder like every other one: nothing typed reaches the wire unchecked.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { HEARD_BLUEPRINTS } from '../devices/index.js';
import { isCreated } from '../devices/helpers.js';
import { SEND_PROTOCOLS } from '../rfplayer/protocol.js';
import { freeOrderCommand } from './orders.js';

/** Key of the manifest widget. Never renamed: dashboards store it. */
export const RFPLAYER_WIDGET = 'rfplayer';

/** Widget action keys: relayed back by key, never renamed. */
export const WIDGET_ACTIONS = { PING: 'ping', SEND_ORDER: 'send_order' };

/** The content budget of the core: 8 components at most. */
const MAX_COMPONENTS = 8;

/** Orders of the form, as the `send_order` scene action words them. */
export const FORM_ORDERS = [
  {
    value: 'on',
    label: { en: 'On / up', fr: 'Allumer / monter', de: 'Ein / hoch', es: 'Encender / subir' },
  },
  {
    value: 'off',
    label: {
      en: 'Off / down',
      fr: 'Éteindre / descendre',
      de: 'Aus / runter',
      es: 'Apagar / bajar',
    },
  },
  {
    value: 'dim',
    label: {
      en: 'Dim to level',
      fr: 'Varier au niveau',
      de: 'Auf Stufe dimmen',
      es: 'Atenuar al nivel',
    },
  },
  {
    value: 'my',
    label: {
      en: 'My (Somfy RTS)',
      fr: 'My (Somfy RTS)',
      de: 'My (Somfy RTS)',
      es: 'My (Somfy RTS)',
    },
  },
  {
    value: 'toggle',
    label: {
      en: 'Toggle (Edisio)',
      fr: 'Inverser (Edisio)',
      de: 'Umschalten (Edisio)',
      es: 'Alternar (Edisio)',
    },
  },
  { value: 'assoc', label: { en: 'Pair', fr: 'Appairer', de: 'Anlernen', es: 'Emparejar' } },
  {
    value: 'dissoc',
    label: { en: 'Unpair', fr: 'Désappairer', de: 'Ablernen', es: 'Desemparejar' },
  },
];

/** The "Send a radio order" button and its form (4 fields, the core's maximum). */
function orderButton() {
  return {
    type: 'button',
    label: {
      en: 'Send a radio order',
      fr: 'Envoyer un ordre radio',
      de: 'Funkbefehl senden',
      es: 'Enviar orden de radio',
    },
    icon: 'send',
    style: 'secondary',
    action: {
      key: WIDGET_ACTIONS.SEND_ORDER,
      fields: [
        {
          key: 'protocol',
          type: 'select',
          label: { en: 'Protocol', fr: 'Protocole', de: 'Protokoll', es: 'Protocolo' },
          required: true,
          default: 'CHACON',
          options: SEND_PROTOCOLS.map((protocol) => ({
            value: protocol,
            label: { en: protocol, fr: protocol, de: protocol, es: protocol },
          })),
        },
        {
          key: 'address',
          type: 'string',
          label: { en: 'Address', fr: 'Adresse', de: 'Adresse', es: 'Dirección' },
          placeholder: {
            en: '0 to 255, or A1 to P16',
            fr: '0 à 255, ou A1 à P16',
            de: '0 bis 255 oder A1 bis P16',
            es: '0 a 255, o A1 a P16',
          },
          required: true,
        },
        {
          key: 'order',
          type: 'select',
          label: { en: 'Order', fr: 'Ordre', de: 'Befehl', es: 'Orden' },
          required: true,
          default: 'on',
          options: FORM_ORDERS,
        },
        {
          key: 'level',
          type: 'number',
          label: { en: 'Level (%)', fr: 'Niveau (%)', de: 'Stufe (%)', es: 'Nivel (%)' },
          required: false,
          min: 0,
          max: 100,
        },
      ],
    },
  };
}

export const DEFAULT_EMITTERS = 5;
const MAX_EMITTERS = 8;

export const DOCS_URL = 'https://github.com/prohand/gladys-rfplayer/blob/main/docs/en.md';

const KIND_LABELS = {
  sensor: { en: 'sensor', fr: 'capteur', de: 'Sensor', es: 'sensor' },
  detector: { en: 'detector', fr: 'détecteur', de: 'Melder', es: 'detector' },
  remote: { en: 'remote', fr: 'télécommande', de: 'Fernbedienung', es: 'mando' },
  other: { en: 'not used', fr: 'non utilisé', de: 'nicht verwendet', es: 'no usado' },
};

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "12 s ago" / "il y a 12 s" / "vor 12 s" / "hace 12 s". */
export function describeAge(at, now) {
  if (at === null || at === undefined) {
    return { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' };
  }
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  let amount;
  if (seconds < 60) amount = `${seconds} s`;
  else if (seconds < 3600) amount = `${Math.round(seconds / 60)} min`;
  else if (seconds < 86_400) amount = `${Math.round(seconds / 3600)} h`;
  else amount = `${Math.round(seconds / 86_400)} d`;
  return {
    en: `${amount} ago`,
    fr: `il y a ${amount.replace(' d', ' j')}`,
    de: `vor ${amount.replace(' d', ' T.')}`,
    es: `hace ${amount}`,
  };
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
      de: clip([kind.de, what].filter(Boolean).join(' · '), 60),
      es: clip([kind.es, what].filter(Boolean).join(' · '), 60),
    },
    date: new Date(entry.lastSeen).toISOString(),
    badge: created
      ? {
          text: { en: 'in Gladys', fr: 'dans Gladys', de: 'in Gladys', es: 'en Gladys' },
          color: WIDGET_COLORS.SUCCESS,
        }
      : blueprint
        ? {
            text: { en: 'to create', fr: 'à créer', de: 'anzulegen', es: 'por crear' },
            color: WIDGET_COLORS.NEUTRAL,
          }
        : {
            text: { en: 'ignored', fr: 'ignoré', de: 'ignoriert', es: 'ignorado' },
            color: WIDGET_COLORS.NEUTRAL,
          },
    description: {
      en: `Heard ${age.en}, ${entry.frames} frame(s), quality ${quality}/10.`,
      fr: `Entendu ${age.fr}, ${entry.frames} trame(s), qualité ${quality}/10.`,
      de: `Empfangen ${age.de}, ${entry.frames} Frame(s), Qualität ${quality}/10.`,
      es: `Recibido ${age.es}, ${entry.frames} trama(s), calidad ${quality}/10.`,
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
        de: 'Keine Bridge-Adresse: Trage sie in der Konfiguration ein.',
        es: 'No hay dirección del puente: indíquela en la configuración.',
      },
    });
  } else if (config.configErrors.length > 0) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: `${config.configErrors.length} configuration error(s): see Test the connection.`,
        fr: `${config.configErrors.length} erreur(s) de configuration : voir Tester la connexion.`,
        de: `${config.configErrors.length} Konfigurationsfehler: siehe Verbindung testen.`,
        es: `${config.configErrors.length} error(es) de configuración: vea Probar la conexión.`,
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
        label: { en: 'Dongle', fr: 'Clé', de: 'Stick', es: 'Llave' },
        icon: 'radio',
        value: link.ready
          ? { en: 'Connected', fr: 'Connectée', de: 'Verbunden', es: 'Conectada' }
          : { en: 'Disconnected', fr: 'Déconnectée', de: 'Getrennt', es: 'Desconectada' },
        color: link.ready ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
      },
      {
        label: { en: 'Bridge', fr: 'Passerelle', de: 'Bridge', es: 'Puente' },
        icon: 'server',
        value: clip(config.host ? `${config.host}:${config.port}` : '—', 40),
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: { en: 'Model', fr: 'Modèle', de: 'Modell', es: 'Modelo' },
        icon: 'cpu',
        value: clip(dongle || '—', 40),
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: { en: 'Last frame', fr: 'Dernière trame', de: 'Letzter Frame', es: 'Última trama' },
        icon: 'clock',
        value: describeAge(heard.lastFrameAt, now),
        color: WIDGET_COLORS.INFO,
      },
      {
        label: {
          en: 'Frames ignored',
          fr: 'Trames ignorées',
          de: 'Ignorierte Frames',
          es: 'Tramas ignoradas',
        },
        icon: 'filter',
        value: heard.ignored,
        color: heard.ignored > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      },
      {
        label: { en: 'Jamming', fr: 'Brouillage', de: 'Störung', es: 'Interferencia' },
        icon: 'shield',
        value: jamming
          ? { en: 'DETECTED', fr: 'DÉTECTÉ', de: 'ERKANNT', es: 'DETECTADA' }
          : { en: 'None', fr: 'Aucun', de: 'Keine', es: 'Ninguna' },
        color: jamming ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
      },
    ],
  });

  const entries = heard.list();
  components.push(
    {
      type: 'value',
      label: {
        en: 'Emitters heard',
        fr: 'Émetteurs entendus',
        de: 'Empfangene Sender',
        es: 'Emisores recibidos',
      },
      icon: 'radio',
      value: entries.length,
    },
    {
      type: 'value',
      label: {
        en: 'Frames received',
        fr: 'Trames reçues',
        de: 'Empfangene Frames',
        es: 'Tramas recibidas',
      },
      icon: 'activity',
      value: heard.frames,
    },
    {
      type: 'value',
      label: {
        en: 'Orders sent',
        fr: 'Ordres envoyés',
        de: 'Gesendete Befehle',
        es: 'Órdenes enviadas',
      },
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
      label: {
        en: 'Test the dongle',
        fr: 'Tester la clé',
        de: 'Stick testen',
        es: 'Probar la llave',
      },
      icon: 'zap',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.PING },
    },
    {
      type: 'button',
      label: {
        en: 'Documentation',
        fr: 'Documentation',
        de: 'Dokumentation',
        es: 'Documentación',
      },
      icon: 'book-open',
      style: 'secondary',
      link: { url: DOCS_URL },
    },
  );
  // Last, and only within the budget: the core drops what overflows in content
  // order, and a configuration notice or the emitters matter more.
  if (components.length < MAX_COMPONENTS) components.push(orderButton());

  // Frames refresh it (see RfPlayerService.refreshWidgets): the TTL is a safety net.
  return { ttl_seconds: 120, components };
}

/** A tapped widget button: resolves the toast. */
export async function widgetAction(service, actionKey, { values } = {}) {
  if (actionKey === WIDGET_ACTIONS.SEND_ORDER) {
    return sendFormOrder(service, values);
  }
  if (actionKey !== WIDGET_ACTIONS.PING) {
    throw new Error(`Unknown widget action: ${actionKey}`);
  }
  if (!service.link.ready) {
    return {
      en: 'The dongle is not connected.',
      fr: "La clé n'est pas connectée.",
      de: 'Der Stick ist nicht verbunden.',
      es: 'La llave no está conectada.',
    };
  }
  const ms = await service.link.ping();
  return {
    en: `The dongle answered in ${ms} ms.`,
    fr: `La clé a répondu en ${ms} ms.`,
    de: `Der Stick hat in ${ms} ms geantwortet.`,
    es: `La llave ha respondido en ${ms} ms.`,
  };
}

/**
 * The "Send a radio order" form. A core too old for widget forms relays the
 * action without `values`: refused, never guessed. An invalid order throws
 * (the core shows the reason); a dongle that is down is a toast.
 */
async function sendFormOrder(service, values) {
  if (!values?.protocol || !values?.address || !values?.order) {
    throw new Error('Fill in the protocol, the address and the order in the form of the button');
  }
  const command = freeOrderCommand(values);
  if (!service.link.ready) {
    return {
      en: 'The dongle is not connected: order not sent.',
      fr: "La clé n'est pas connectée : ordre non envoyé.",
      de: 'Der Stick ist nicht verbunden: Befehl nicht gesendet.',
      es: 'La llave no está conectada: orden no enviada.',
    };
  }
  await service.link.order(command);
  service.noteOrder(command);
  return {
    en: `Order sent: ${command}`,
    fr: `Ordre envoyé : ${command}`,
    de: `Befehl gesendet: ${command}`,
    es: `Orden enviada: ${command}`,
  };
}
