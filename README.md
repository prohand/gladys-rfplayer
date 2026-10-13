# Gladys RFPlayer

External integration for [Gladys Assistant](https://gladysassistant.com) that
drives a **Ziblue / GCE Electronics RFPlayer RFP1000**, the 433/868 MHz USB
dongle that decodes and emits most home-automation radio protocols. Built from
the official template
[`integration-template-js`](https://github.com/GladysAssistant/integration-template-js)
and the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

- **Transport: local only** (`"transports": ["local"]`). No cloud, no account:
  the dongle is on your network, every device carries a `local` /
  `unreachable` badge.
- **Gladys ≥ 5.1.0** (scene triggers, scene actions, dashboard widget).
- Catalog categories: `protocols`, `security`, `environment`.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## How it reaches the dongle

The integration runs in the Gladys sandbox, which gives a container **no USB
or serial device**. The RFPlayer therefore stays plugged into a machine of the
LAN and is exposed over TCP by a serial-to-TCP bridge (ser2net, socat,
ESP-Link…, 115200 bauds). The integration connects to `host:port`, says HELLO,
switches the dongle to JSON frames (`FORMAT JSON`), sets the receivers and the
jamming threshold, then PINGs it every minute. Ready-made ser2net
configurations are in the [documentation](docs/en.md#1-expose-the-dongle-over-tcp).

## What it does

| Family                 | Devices                                                                                | How they appear                                          |
| ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Measuring sensors      | Oregon Scientific (temperature, humidity, pressure, wind, rain, UV), OWL energy meters | Heard on the air → Discovery tab                         |
| Detectors              | Visonic, X2D (alarm, tamper, low battery), KD101 smoke detectors                       | Heard on the air → Discovery tab, kind set in the config |
| Remotes, wall switches | Chacon/DiO, X10, Domia, Blyss, Somfy RTS, X2D, Visonic keyfobs, FS20…                  | Heard on the air → Discovery tab                         |
| Actuators              | Switches, dimmable lights, Somfy RTS shutters ("my" = stop), buttons (gates, bells)    | Declared in the config, or with "Pair an actuator"       |
| The dongle             | Its jamming detector                                                                   | Discovered once connected                                |

Gladys 5.1 capabilities:

| Capability   | Manifest key       | Code                                                          |
| ------------ | ------------------ | ------------------------------------------------------------- |
| Trigger      | `remote_pressed`   | [`src/devices/index.js`](src/devices/index.js) (`applyEvent`) |
| Trigger      | `alarm_detected`   | idem                                                          |
| Trigger      | `battery_low`      | idem                                                          |
| Trigger      | `jamming`          | idem                                                          |
| Scene action | `send_order`       | [`src/capabilities/scenes.js`](src/capabilities/scenes.js)    |
| Scene action | `simulate_jamming` | idem                                                          |
| Widget       | `rfplayer`         | [`src/capabilities/widget.js`](src/capabilities/widget.js)    |

Configuration-screen actions: **Test the connection**, **Pair an actuator**,
**Simulate a jamming** ([`src/capabilities/actions.js`](src/capabilities/actions.js)).

## Project structure

```
.
├─ index.js                     # SDK wiring only
├─ src/
│  ├─ service.js                # runtime: frames -> states/events, commands, status
│  ├─ config.js                 # defaults, `actuators` / `detector_kinds` parsers
│  ├─ rfplayer/
│  │  ├─ protocol.js            # ZIA++ commands, ZIA-- / ZIA33 lines (RFPlayer API)
│  │  ├─ frames.js              # JSON frame -> event
│  │  ├─ connection.js          # TCP link, reconnection, write queue, PING
│  │  └─ heard.js               # emitters heard, saved to /data
│  ├─ devices/                  # one file per device kind + registry (index.js)
│  └─ capabilities/             # manifest actions, scene actions, widget
├─ docs/{en,fr,de,es}.md        # user documentation (re-hosted by Gladys)
├─ test/                        # node --test, no network, no hardware
├─ gladys-assistant-integration.json
├─ Dockerfile                   # Node 24 Alpine, read-only rootfs, non-root
├─ CHANGELOG.md                 # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                    # project rules for coding assistants & contributors
├─ SECURITY.md                  # how to report a vulnerability privately
└─ .github/
   ├─ workflows/ci.yml          # format, lint, tests (Node 22 + 24), store checks, Docker build
   ├─ workflows/release.yml     # UI-driven release: bump + changelog + tag + build + release
   ├─ workflows/build.yml       # multi-arch image (amd64 + arm64) to ghcr.io
   ├─ workflows/github-release.yml # a GitHub Release for every version tag
   ├─ scripts/changelog-release.mjs
   └─ dependabot.yml            # npm weekly, Actions and Docker monthly
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="rfplayer" \
LOG_LEVEL=debug \
npm start
```

Outside a container, the emitters heard are saved to `/data` only if it is
writable; a failed save is logged and ignored.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test (LOG_LEVEL=silent npm test for a quiet run)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI runs the first three on Node 22 and 24 for every push and pull request;
pull requests also run the store checks and build the Docker image.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps `package.json`, `package-lock.json` and the manifest
(`version` + `docker_image`), rolls the changelog, tags `vX.Y.Z`, builds the
`linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-rfplayer`
(`:X.Y.Z` and `:latest`) and publishes the GitHub Release. The repository needs
the `gladys-assistant-integration` topic to be indexed by the store.

## License

Apache-2.0
