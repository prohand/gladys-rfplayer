// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
//   test_connection   is the dongle there, what does it receive, what is wrong
//                     with the configuration;
//   pair_actuator     declare a receiver AND pair it in one go: the dongle
//                     sends the ASSOC frame (the receiver must be in learning
//                     mode), and the line is appended to the `actuators`
//                     setting through setConfig;
//   simulate_jamming  test the jamming detector and the scenes built on it.
//
// Every handler resolves a multi-language message, shown under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatActuator, parseActuators } from '../config.js';
import { ACTIONS, buildOrder } from '../rfplayer/protocol.js';
import { simulateJammingCommand } from './orders.js';

const logger = createLogger({ name: 'actions' });

const notConnected = (service) => {
  if (!service.config.host) {
    return {
      en: 'No bridge address yet: fill in the Host field and save.',
      fr: "Pas encore d'adresse de passerelle : remplissez le champ Hôte et enregistrez.",
      de: 'Noch keine Bridge-Adresse: Fülle das Feld Host der Bridge aus und speichere.',
      es: 'Todavía no hay dirección del puente: rellene el campo Host del puente y guarde.',
    };
  }
  const where = `${service.config.host}:${service.config.port}`;
  const reason = service.link.lastError ?? 'connecting';
  return {
    en: `RFPlayer unreachable at ${where} (${reason}). Check that the bridge runs and the dongle is plugged in.`,
    fr: `RFPlayer injoignable à ${where} (${reason}). Vérifiez que la passerelle tourne et que la clé est branchée.`,
    de: `RFPlayer unter ${where} nicht erreichbar (${reason}). Prüfe, ob die Bridge läuft und der Stick eingesteckt ist.`,
    es: `RFPlayer inaccesible en ${where} (${reason}). Compruebe que el puente funciona y que la llave está conectada.`,
  };
};

export const MANIFEST_ACTIONS = {
  async test_connection(service) {
    if (!service.link.ready) {
      return notConnected(service);
    }
    const ms = await service.link.ping();
    let receivers = null;
    try {
      receivers = (await service.link.systemStatus()).receiverEnabled ?? null;
    } catch (err) {
      logger.debug(`STATUS SYSTEM failed: ${err.message}`);
    }
    const { model, firmware } = service.link.info;
    const heard = service.heard.list().length;
    const actuators = service.config.actuatorList.length;
    const errors = service.config.configErrors;
    const lines = {
      en: [
        `RFPlayer ${model ?? ''} OK, firmware ${firmware ?? '?'}, answered in ${ms} ms.`,
        receivers ? `Receiving: ${receivers.join(' ')}.` : null,
        `${heard} emitter(s) heard, ${actuators} actuator(s) declared.`,
        errors.length ? `Configuration errors: ${errors.join(' | ')}` : null,
      ],
      fr: [
        `RFPlayer ${model ?? ''} OK, firmware ${firmware ?? '?'}, réponse en ${ms} ms.`,
        receivers ? `Réception : ${receivers.join(' ')}.` : null,
        `${heard} émetteur(s) entendu(s), ${actuators} actionneur(s) déclaré(s).`,
        errors.length ? `Erreurs de configuration : ${errors.join(' | ')}` : null,
      ],
      de: [
        `RFPlayer ${model ?? ''} OK, Firmware ${firmware ?? '?'}, Antwort in ${ms} ms.`,
        receivers ? `Empfang: ${receivers.join(' ')}.` : null,
        `${heard} Sender empfangen, ${actuators} Aktor(en) angelegt.`,
        errors.length ? `Konfigurationsfehler: ${errors.join(' | ')}` : null,
      ],
      es: [
        `RFPlayer ${model ?? ''} OK, firmware ${firmware ?? '?'}, respuesta en ${ms} ms.`,
        receivers ? `Recepción: ${receivers.join(' ')}.` : null,
        `${heard} emisor(es) recibido(s), ${actuators} actuador(es) declarado(s).`,
        errors.length ? `Errores de configuración: ${errors.join(' | ')}` : null,
      ],
    };
    return Object.fromEntries(
      Object.entries(lines).map(([lang, parts]) => [lang, parts.filter(Boolean).join(' ')]),
    );
  },

  async pair_actuator(service, fields) {
    const line = formatActuator({
      name: fields.name,
      kind: fields.kind,
      protocol: String(fields.protocol ?? '').toUpperCase(),
      address: addressOf(fields.address),
      qualifier: optionalNumber(fields.qualifier),
    });
    // Parse the new list as a whole: same checks as a line typed by hand,
    // duplicates included.
    const current = service.config.actuators.trim();
    const next = current ? `${current}; ${line}` : line;
    const { actuators, errors } = parseActuators(next);
    const fresh = errors.find((error) => error.startsWith(`"${line}"`));
    if (fresh) {
      throw new Error(fresh);
    }
    const actuator = actuators.at(-1);

    if (fields.send_pairing !== false) {
      if (!service.link.ready) {
        return notConnected(service);
      }
      const command = buildOrder({
        action: ACTIONS.ASSOC,
        protocol: actuator.protocol,
        address: actuator.address,
        qualifier: actuator.qualifier,
      });
      await service.link.order(command);
      service.noteOrder(command);
    }

    await service.gladys.setConfig({ actuators: next });
    await service.applyConfig({ ...service.rawConfig, actuators: next });
    return {
      en: `"${actuator.name}" added (${line}). Create it from the Discover tab.`,
      fr: `« ${actuator.name} » ajouté (${line}). Créez-le depuis l'onglet Découverte.`,
      de: `„${actuator.name}“ hinzugefügt (${line}). Lege es im Tab „Entdecken“ an.`,
      es: `«${actuator.name}» añadido (${line}). Créelo desde la pestaña «Descubrir».`,
    };
  },

  async simulate_jamming(service, fields) {
    if (!service.link.ready) {
      return notConnected(service);
    }
    const delay = Number(fields?.delay ?? 0);
    await service.link.order(simulateJammingCommand(delay));
    const when =
      delay > 0
        ? {
            en: `in ${delay} s`,
            fr: `dans ${delay} s`,
            de: `in ${delay} s`,
            es: `dentro de ${delay} s`,
          }
        : { en: 'now', fr: 'maintenant', de: 'sofort', es: 'ahora' };
    return {
      en: `Jamming simulated: the dongle reports it ${when.en}, and its end 5 seconds later.`,
      fr: `Brouillage simulé : la clé le signale ${when.fr}, puis sa fin 5 secondes après.`,
      de: `Störung simuliert: Der Stick meldet sie ${when.de} und ihr Ende 5 Sekunden später.`,
      es: `Interferencia simulada: la llave la notifica ${when.es} y su fin 5 segundos después.`,
    };
  },
};

function addressOf(raw) {
  const text = String(raw ?? '').trim();
  return /^\d+$/.test(text) ? { id: Number(text) } : { x10: text.toUpperCase() };
}

function optionalNumber(value) {
  return value === undefined || value === null || value === '' ? undefined : Number(value);
}
