# RFPlayer integration

Connect a **Ziblue / GCE Electronics RFPlayer RFP1000** (433 and 868 MHz) to
Gladys: radio sensors and detectors, remotes and wall switches, and the
receivers the dongle drives (plugs, lights, Somfy RTS shutters, gates).

## 1. Expose the dongle over TCP

The integration runs in an isolated container that **cannot open a USB
port**. The RFPlayer stays plugged into a machine of your network (the Gladys
host, a Raspberry Pi…), and a small "serial-to-TCP bridge" makes its serial
port reachable on the network. The data is the same, at 115200 bauds.

Find the stable name of the dongle:

```bash
ls -l /dev/serial/by-id/
```

### With ser2net 4 (Debian 11+, Raspberry Pi OS)

```bash
sudo apt install ser2net
```

`/etc/ser2net.yaml`:

```yaml
connection: &rfplayer
  accepter: tcp,4000
  enable: on
  options:
    kickolduser: true
  connector: serialdev,/dev/serial/by-id/usb-XXXX-if00-port0,115200n81,local
```

Replace the `/dev/serial/by-id/...` path with yours, then
`sudo systemctl restart ser2net`.

### With ser2net 3

`/etc/ser2net.conf`:

```
4000:raw:0:/dev/serial/by-id/usb-XXXX-if00-port0:115200 8DATABITS NONE 1STOPBIT
```

### With socat (quick test)

```bash
socat TCP-LISTEN:4000,reuseaddr,fork FILE:/dev/serial/by-id/usb-XXXX-if00-port0,b115200,raw,echo=0
```

> The bridge has **no password**: whoever reaches the port drives your radio
> devices. Keep it on your LAN, never forward it to the Internet. With ser2net
> you can bind it to one address: `accepter: tcp,192.168.1.10,4000`.

## 2. Configure the integration

| Field                        | What to put                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Bridge host                  | IP of the machine running the bridge. For the Gladys host itself, its **LAN IP** — `localhost` is the container itself. |
| Bridge TCP port              | `4000` in the examples above.                                                                                           |
| Protocols received           | Leave empty for all. Untick what you do not use to hear fewer neighbours.                                               |
| Minimum radio quality        | 0 keeps everything; 3 or 4 drops the far-away (neighbours') emitters.                                                   |
| Jamming detection threshold  | 7 by default; 1 = very sensitive, 10 = needs a jammer on both bands, 0 = off.                                           |
| Identify Oregon / OWL probes | "Address" (default) or "Model and channel" — see below.                                                                 |
| Actuators                    | The receivers the dongle drives — see section 4.                                                                        |
| Detector types               | Which detector is a door contact, a smoke detector… — see section 3.                                                    |

Click **Test the connection**: it shows the model, the firmware, the answer
time and the protocols received, plus any error in your settings.

## 3. Sensors, detectors and remotes (heard)

Nothing to declare: as soon as the dongle hears a device, it appears in the
**Discover** tab. Create the ones that are yours — the neighbours' probes are
heard too, they simply stay there. Values and scene triggers only reach the
devices you created.

- **Oregon Scientific probes**: temperature, humidity, pressure, wind speed and
  direction, rain, UV. **OWL** meters: power (per phase on CM180i) and energy.
  Oregon probes draw a new random address at every battery change. With
  "Address", two identical probes on the same channel are told apart, but a
  battery change creates a new device. With "Model and channel", the device
  survives battery changes, as long as each probe of a model is set on its own
  channel. Changing this setting creates new devices.
- **Visonic and X2D detectors**: alarm, tamper and low battery. On the air a
  door contact looks like a motion detector, so tell the integration in
  **Detector types**, e.g. `VISONIC 1166992416 = opening; X2D 7894561 = smoke`
  (kinds: `motion`, `opening`, `smoke`, `leak`, `vibration`, `presence`). The id
  is shown in the widget and in the device parameters. Motion and smoke
  detectors never send "it stopped": their alarm returns to 0 after 1 to 2
  minutes.
- **KD101 smoke detectors**: the alert.
- **Remotes and wall switches** (Chacon/DiO, X10, Domia, Blyss, Somfy RTS, X2D,
  Visonic keyfobs, FS20…): the device shows the last on/off order (up/my/down
  for an RTS remote), and every press fires the **A radio remote is pressed**
  scene trigger with the exact order.

## 4. Actuators (driven by the dongle)

A receiver cannot be discovered over the air: declare it. The easiest way is
the **Pair an actuator** button:

1. put the receiver in learning mode (press the button of a Chacon plug, hold
   PROG on the original remote of a Somfy RTS shutter until it jogs…);
2. fill in a name, the kind, the protocol and a free address (0 to 255, or A1
   to P16), then run the action;
3. the dongle sends the pairing frame, and the receiver is added to the
   **Actuators** field. Create it from the **Discover** tab.

You can also type the field by hand, entries separated by `;`:

```
Living room shutter = shutter RTS 1; Desk lamp = switch CHACON 12; Hall = light X10 A3; Gate = button RTS 2 qualifier=1
```

| Kind      | What it does                                                                      |
| --------- | --------------------------------------------------------------------------------- |
| `switch`  | On / off.                                                                         |
| `light`   | On / off and brightness (protocols with a dim order: X10, Chacon dimmers, FS20…). |
| `shutter` | Open / stop / close. On Somfy RTS, stop is the "my" button.                       |
| `button`  | A single order (gate, garage door, bell). An RTS gate needs `qualifier=1`.        |

The address is not the one of your old remote: the dongle combines it with its
own identifier, so `ID 1` of your RFPlayer never drives a neighbour's device.
Radio orders are never acknowledged: Gladys shows what it sent.

## 5. Scenes and dashboard (Gladys 5.1+)

Triggers:

- **A radio remote is pressed** — filter on the remote and the order;
  variables: name, order, protocol, address.
- **A radio detector is triggered** — alarm or tamper.
- **A radio device battery is low**.
- **Radio jamming** — started or stopped. A jammer is the classic way to blind
  a wireless alarm: build a notification scene on it.

Actions:

- **Send a radio order** — any order to any address, even one not declared
  (a second channel, the RTS "my"…). Its `sent` output is false when the dongle
  is not connected.
- **Simulate a radio jamming** — to test your alarm scene end to end.

The **RFPlayer radio** widget shows whether the dongle is connected, the
jamming state, the counters and the last emitters heard, with a badge telling
whether each one is already a device in Gladys.

## Troubleshooting

- **"RFPlayer unreachable"**: check the bridge (`systemctl status ser2net`),
  the IP and port, and that no other program holds the serial port
  (`kickolduser` helps with ser2net). From another machine:
  `nc 192.168.1.10 4000` then type `ZIA++HELLO` + Enter: the dongle answers
  `ZIA--Welcome to Ziblue Dongle…`.
- **Connected, then unreachable every minute**: the bridge port is open but the
  dongle does not answer PING — unplugged, or another baud rate.
- **A remote is not seen**: is its protocol ticked in "Protocols received"? Is
  the minimum quality too high? The widget lists what is heard, created or not.
- **A shutter does not move**: it must be paired once (section 4). For RTS,
  the shutter must be in programming mode (PROG held on its remote) when the
  pairing frame is sent.
- **Too many devices in the Discover tab**: raise the minimum radio quality, untick
  the protocols you do not use.
