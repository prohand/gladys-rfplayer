# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human
contributors when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one
runtime dependency: `@gladysassistant/integration-sdk`) for the **Ziblue / GCE
RFPlayer RFP1000**, a 433/868 MHz USB dongle that decodes and emits many radio
protocols (Chacon/DiO, X10, Somfy RTS, Visonic, X2D, Oregon, OWL, Blyss, KD101,
FS20, Edisio, Parrot…). It started from the official JavaScript template
(GladysAssistant/integration-template-js); the workflows mirror
prohand/gladys-devmel.

Gladys 5.1+ capabilities: scene triggers (remote pressed, detector triggered,
battery low, jamming), scene actions (send an order, simulate a jamming) and the
"RFPlayer radio" widget.

## Commands

```bash
npm install
npm test                                  # node --test (built-in runner)
node --test test/frames.test.js           # one file
node --test --test-name-pattern "jamming" # tests whose name matches
LOG_LEVEL=silent npm test                 # same, without the log lines
npm run lint                              # eslint .
npm run format:check                      # prettier --check . (CI gate)
npm run format                            # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node
22 and 24; on pull requests it also runs the store checks and builds the Docker
image. Run the three commands before pushing. Releases: **Actions → Release**
only.

## Architecture

```
index.js                     SDK wiring only (handlers registered before connect())
src/service.js               the runtime: frames -> states/events, commands, status
src/config.js                DEFAULT_CONFIG + parsing of the `actuators` / `detector_kinds` texts
src/rfplayer/protocol.js     ZIA++ commands (build, validate) and ZIA-- / ZIA33 lines (parse)
src/rfplayer/frames.js       JSON frame -> event (sensor, detector, remote, jamming, other)
src/rfplayer/connection.js   TCP link: reconnection, line splitting, one write queue, PING
src/rfplayer/heard.js        emitters heard, bounded, saved to /data
src/devices/index.js         registry, discovery payload, applyEvent (states + scene events)
src/devices/<kind>.js        gateway, sensor, detector, remote (heard) / switch, light, shutter, button (declared)
src/capabilities/            manifest actions, scene actions, widget, free orders
docs/en.md, docs/fr.md       user documentation (re-hosted by Gladys), kept in sync
test/                        node --test; fakes in test/helpers/
```

### Invariants worth knowing

- **No USB in the container.** The Gladys sandbox grants no `/dev/tty*`: the
  dongle is reached over TCP through a serial-to-TCP bridge. Do not add a serial
  dependency.
- **Commands are validated, never concatenated.** Every line written goes
  through `buildOrder` / `toLine`, which refuse anything but known actions,
  protocols, addresses and numbers. `.` is the dongle's command separator: user
  input must never carry one (a scene could otherwise send `FACTORYRESET`).
- **Radio orders are never acknowledged**: actuator features are
  `has_feedback: false` and show what Gladys sent.
- **Heard devices only publish once created**: states and scene events go to
  devices present in `gladys.devices`; values are remembered in the registry and
  replayed on `onDeviceCreated`. The neighbours' probes stay in Discovery.
- **One press, one event**: remotes repeat each frame on the air; copies within
  1.5 s are one press (`RfPlayerService.isRepeat`).
- **Motion and smoke detectors never send "it stopped"**: their alarm is reset
  to 0 by a timer (`resetAfterMs` in detector.js).
- **External ids are forever**: `<kind>:<protocol>-<address>` for actuators and
  remotes, `sensor:<protocol>-<model>-<adr or channel>` for probes,
  `rfplayer:<mac>` for the dongle. Scene, action, widget and feature keys are
  stored by users too: never rename them.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys).
- **The rootfs is read-only**: write only under `/data`.

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or the manifest, nor the `docker_image` tag, by
  hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading yourself.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects (`label`,
  `description`, `placeholder`). The catalog `description` holds 10 to 100
  characters per language. `test/manifest.test.js` ties the manifest to the code
  (defaults, actions, scene triggers and actions, widget, select options):
  change both sides together.
- **User-facing text** is bilingual (English and French): messages, manifest,
  `docs/en.md` / `docs/fr.md`.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in
  English. Tests never touch the network nor real hardware.
