// -----------------------------------------------------------------------------
// A service wired to fakes: Gladys, the link, an in-memory registry.
// -----------------------------------------------------------------------------

import { HeardRegistry } from '../../src/rfplayer/heard.js';
import { RfPlayerService } from '../../src/service.js';
import { createFakeGladys } from './fakeGladys.js';
import { createFakeLink } from './fakeLink.js';

export async function createService({ config = {}, ready = true, now } = {}) {
  const gladys = createFakeGladys();
  const link = createFakeLink({ ready });
  const clock = { t: 1_700_000_000_000 };
  const heard = new HeardRegistry({ file: null, now: now ?? (() => clock.t) });
  const service = new RfPlayerService({
    gladys,
    link,
    heard,
    options: { now: now ?? (() => clock.t), widgetKeys: ['rfplayer'], rediscoverDelayMs: 0 },
  });
  await service.applyConfig({ host: '192.168.1.10', ...config });
  gladys.calls.discovered.length = 0;
  gladys.calls.connectionStatuses.length = 0;
  gladys.calls.widgetRefreshes.length = 0;
  return { gladys, link, heard, service, clock };
}

/** Let pending timers of 0 ms (rediscovery) run. */
export const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
