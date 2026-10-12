// -----------------------------------------------------------------------------
// Stand-in for RfPlayerLink: records the orders instead of writing them.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export function createFakeLink({ ready = true } = {}) {
  const link = new EventEmitter();
  Object.assign(link, {
    ready,
    lastError: ready ? null : 'connection refused',
    info: { model: 'RFP1000', firmware: '1.39', mac: 'f6c09fa1' },
    orders: [],
    configured: [],
    stopped: false,
    configure(config) {
      link.configured.push(config);
    },
    async order(command) {
      if (!link.ready) throw new Error('RFPlayer not connected');
      link.orders.push(command);
    },
    async ping() {
      return 12;
    },
    async systemStatus() {
      return { Version: '1.39', receiverEnabled: ['X10', 'RTS', 'CHACON'] };
    },
    stop() {
      link.stopped = true;
    },
  });
  return link;
}
