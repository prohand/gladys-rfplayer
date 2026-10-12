// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+), declared in the manifest `scene_actions`.
//
//   send_order        any radio order, to any address: the escape hatch for a
//                     receiver not declared as an actuator (a second channel
//                     of a remote, a pilot-wire module…), or the RTS "my";
//   simulate_jamming  make the dongle report a jamming, to test an alarm
//                     scene end to end without a jammer.
//
// The rules (SDK): fields arrive resolved and validated by the core; resolve
// the declared outputs only; a throw fails this action alone. A link that is
// down is an OUTPUT (`sent: false`) the scene can gate on, not a failure; an
// invalid order typed by the scene author is a failure, logged with its reason.
// Scene TRIGGERS are fired by src/devices/index.js (applyEvent).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { freeOrderCommand, simulateJammingCommand } from './orders.js';

const logger = createLogger({ name: 'scenes' });

async function sendIfReady(service, command) {
  if (!service.link.ready) {
    logger.warn(`Scene order not sent, RFPlayer not connected: ${command}`);
    return false;
  }
  await service.link.order(command);
  service.noteOrder(command);
  return true;
}

export const SCENE_ACTIONS = {
  async send_order(service, fields) {
    const command = freeOrderCommand(fields);
    const sent = await sendIfReady(service, command);
    return { sent, command };
  },

  async simulate_jamming(service, fields) {
    const sent = await sendIfReady(service, simulateJammingCommand(fields.delay));
    return { sent };
  },
};
