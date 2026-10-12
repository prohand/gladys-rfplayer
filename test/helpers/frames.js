// -----------------------------------------------------------------------------
// Real RFPlayer JSON frames, as printed in the API specification (FORMAT JSON
// examples), plus a few built the same way for the infoTypes it does not show.
// -----------------------------------------------------------------------------

const header = (protocol, protocolMeaning, infoType, extra = {}) => ({
  frameType: '0',
  dataFlag: '0',
  rfLevel: '-41',
  floorNoise: '-97',
  rfQuality: '10',
  protocol,
  protocolMeaning,
  infoType,
  frequency: '433920',
  ...extra,
});

export const FRAMES = {
  oregonRain: {
    header: header('5', 'OREGON', '9', { rfQuality: '5' }),
    infos: {
      subType: '0',
      id_PHY: '0x2A19',
      id_PHYMeaning: 'PCR800',
      adr_channel: '39168',
      adr: '153',
      channel: '0',
      qualifier: '48',
      lowBatt: '0',
      measures: [
        { type: 'total rain', value: '1040.1', unit: 'mm' },
        { type: 'current rain', value: '0.00', unit: 'mm/h' },
      ],
    },
  },
  oregonThermoHygro: {
    header: header('5', 'OREGON', '4', { rfQuality: '4' }),
    infos: {
      subType: '0',
      id_PHY: '0x1A2D',
      id_PHYMeaning: 'THGR122/228/238/268,THGN122/123/132',
      adr_channel: '54273',
      adr: '212',
      channel: '1',
      qualifier: '32',
      lowBatt: '0',
      measures: [
        { type: 'temperature', value: '+23.4', unit: 'Celsius' },
        { type: 'hygrometry', value: '75', unit: '%' },
      ],
    },
  },
  oregonThermoOnly: {
    header: header('5', 'OREGON', '4'),
    infos: {
      subType: '0',
      id_PHY: '0xEA4C',
      id_PHYMeaning: 'THN132',
      adr_channel: '1234',
      adr: '4',
      channel: '2',
      qualifier: '33',
      lowBatt: '1',
      measures: [
        { type: 'temperature', value: '-3.5', unit: 'Celsius' },
        { type: 'hygrometry', value: '0', unit: '%' },
      ],
    },
  },
  owl: {
    header: header('7', 'OWL', '8'),
    infos: {
      subType: '0',
      id_PHY: '0x0003',
      id_PHYMeaning: 'CM180i',
      adr_channel: '784',
      adr: '49',
      channel: '0',
      qualifier: '6',
      lowBatt: '0',
      measures: [
        { type: 'energy', value: '45150', unit: 'Wh' },
        { type: 'power', value: '345', unit: 'W' },
        { type: 'P1', value: '345', unit: 'W' },
        { type: 'P2', value: '0', unit: 'W' },
        { type: 'P3', value: '0', unit: 'W' },
      ],
    },
  },
  blyssOff: {
    header: header('3', 'BLYSS', '1'),
    infos: { subType: '0', id: '4261483730', subTypeMeaning: 'OFF' },
  },
  chaconOn: {
    header: header('4', 'CHACON', '1'),
    infos: { subType: '1', id: '146139014', subTypeMeaning: 'ON' },
  },
  x10On: {
    header: header('1', 'X10', '0'),
    infos: { subType: '1', id: '33', subTypeMeaning: 'ON' },
  },
  rtsUp: {
    header: header('9', 'RTS', '3'),
    infos: {
      subType: '0',
      subTypeMeaning: 'Shutter',
      id: '6793524',
      qualifier: '7',
      qualifierMeaning: 'Up/On',
    },
  },
  rtsMy: {
    header: header('9', 'RTS', '3'),
    infos: { subType: '0', subTypeMeaning: 'Shutter', id: '6793524', qualifier: '4' },
  },
  visonicTamper: {
    header: header('2', 'VISONIC', '2', { dataFlag: '1', frequency: '868950' }),
    infos: {
      subType: '0',
      subTypeMeaning: 'Detector/Sensor',
      id: '1166992416',
      qualifier: '1',
      qualifierMeaning: { flags: ['Tamper'] },
    },
  },
  visonicAlive: {
    header: header('2', 'VISONIC', '2', { dataFlag: '1', frequency: '868950' }),
    infos: {
      subType: '0',
      subTypeMeaning: 'Detector/Sensor',
      id: '1166992416',
      qualifier: '8',
      qualifierMeaning: { flags: ['Supervisor/Alive'] },
    },
  },
  visonicAlarm: {
    header: header('2', 'VISONIC', '2', { dataFlag: '1', frequency: '868950' }),
    infos: { subType: '0', subTypeMeaning: 'Detector/Sensor', id: '1166992416', qualifier: '2' },
  },
  visonicLowBatt: {
    header: header('2', 'VISONIC', '2', { dataFlag: '1', frequency: '868950' }),
    infos: { subType: '0', subTypeMeaning: 'Detector/Sensor', id: '1166992416', qualifier: '12' },
  },
  visonicKeyfob: {
    header: header('2', 'VISONIC', '2'),
    infos: { subType: '1', subTypeMeaning: 'Remote', id: '614725376', qualifier: '16' },
  },
  kd101Alert: {
    header: header('10', 'KD101', '1'),
    infos: { subType: '1', id: '90500', subTypeMeaning: 'ON' },
  },
  x2dRemoteStop: {
    header: header('8', 'X2D', '11', { frequency: '868350' }),
    infos: { subType: '1', id: '7894561', qualifier: '3' },
  },
  x2dThermostat: {
    header: header('8', 'X2D', '10', { frequency: '868350' }),
    infos: { subType: '1', id: '5554', qualifier: '0', function: '2', mode: '3' },
  },
  jammingOn: {
    header: header('15', 'JAMMING', '1', { rfQuality: '2' }),
    infos: { subType: '1', id: '0', subTypeMeaning: 'ON' },
  },
  jammingOff: {
    header: header('15', 'JAMMING', '1', { rfQuality: '2' }),
    infos: { subType: '0', id: '0', subTypeMeaning: 'OFF' },
  },
  weakChacon: {
    header: header('4', 'CHACON', '1', { rfQuality: '2' }),
    infos: { subType: '1', id: '999', subTypeMeaning: 'ON' },
  },
};

/** The `ZIA33` line the dongle prints for a frame. */
export const toZia33 = (frame) => `ZIA33${JSON.stringify({ frame })}`;
