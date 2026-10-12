// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the surface the integration relies on and records every call
// so tests can assert them. `devices` plays the list of devices the user
// created (the SDK keeps it in `gladys.devices`).
// -----------------------------------------------------------------------------

export function createFakeGladys({ devices = [] } = {}) {
  const calls = {
    states: [],
    discovered: [],
    transports: [],
    connectionStatuses: [],
    sceneEvents: [],
    widgetRefreshes: [],
    configs: [],
  };

  return {
    devices: [...devices],
    calls,

    externalIds(type, platformId) {
      const device = `ext:rfplayer:${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },

    /** Pretend the user created the device with this external id. */
    create(externalId, name = 'My device') {
      this.devices.push({ external_id: externalId, name });
    },

    async publishState(featureExternalId, state) {
      calls.states.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const s of states) {
        calls.states.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
    },

    async publishDiscoveredDevices(list) {
      calls.discovered.push(list);
    },

    async publishTransports(entries) {
      calls.transports.push(entries);
    },

    async setConnectionStatus(connected, message) {
      calls.connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data = {}) {
      calls.sceneEvents.push({ key, data });
      return { success: true };
    },

    async setConfig(partial) {
      calls.configs.push(partial);
    },

    requestWidgetRefresh(key) {
      calls.widgetRefreshes.push(key);
    },
  };
}
