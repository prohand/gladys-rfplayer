// -----------------------------------------------------------------------------
// A fake TCP socket standing in for the serial-to-TCP bridge. `dongle` is the
// scripted RFPlayer behind it: it answers HELLO, PING and STATUS like the real
// one, and records every line written.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const HELLO =
  'ZIA--Welcome to Ziblue Dongle RFPLAYER (RFP1000, Firmware V1.39 Mac 0xF6C09FA1)!';

export function createFakeBridge({ answers = true, connect = true } = {}) {
  const bridge = { sockets: [], written: [], answers, connect };

  bridge.createSocket = (target) => {
    const socket = new EventEmitter();
    socket.target = target;
    socket.destroyed = false;
    socket.write = (data) => {
      bridge.written.push(data);
      const command = String(data)
        .replace(/^ZIA\+\+/, '')
        .trim();
      if (!bridge.answers) return true;
      setImmediate(() => {
        if (socket.destroyed) return;
        if (command === 'HELLO') socket.emit('data', `${HELLO}\r\n`);
        if (command === 'PING') socket.emit('data', 'ZIA--PONG\r');
        if (command === 'STATUS SYSTEM JSON') {
          socket.emit(
            'data',
            'ZIA--{"systemStatus": {"reqNum": "0", "info": [{"n" : "Version", "v" : "1.39", "unit" : "", "c" : ""}]}}\r',
          );
        }
      });
      return true;
    };
    socket.destroy = () => {
      if (socket.destroyed) return;
      socket.destroyed = true;
      setImmediate(() => socket.emit('close'));
    };
    bridge.sockets.push(socket);
    setImmediate(() => {
      if (bridge.connect) socket.emit('connect');
      else {
        socket.emit('error', new Error('connect ECONNREFUSED'));
        socket.destroy();
      }
    });
    return socket;
  };

  /** Push raw bytes from the dongle on the current socket. */
  bridge.receive = (text) => bridge.sockets.at(-1).emit('data', text);
  bridge.commands = () => bridge.written.map((line) => line.replace(/^ZIA\+\+/, '').trim());
  return bridge;
}

export const once = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve));
