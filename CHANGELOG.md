# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- "RFPlayer radio" widget: a **Send a radio order** button opens a form (protocol, address,
  order, level) to send any order from the dashboard, validated like the scene action.
- Catalog search keywords (RFP1000, Oregon Scientific, Chacon DiO, Visonic, X2D…).

### Changed

- Gladys 5.3.0 or newer is now required.
- `@gladysassistant/integration-sdk` updated to 0.16.0.

## [2.1.1] - 2026-10-23

- Maintenance release, no functional change.

## [2.1.0] - 2026-10-13

### Added

- German and Spanish translations (configuration screen, messages, widgets, documentation).

### Fixed

- The English documentation names the Gladys screens as the Gladys interface does.

## [2.0.1] - 2026-10-12

### Changed

- `@gladysassistant/integration-sdk` updated to 0.15.0.

### Fixed

- The release script no longer takes the mention of the Unreleased heading in the changelog intro for the section itself, which had left the previous release notes inside the intro.

## [2.0.0] - 2026-10-12

### Added

- First version of the RFPlayer integration, built from the official Gladys
  JavaScript template.
- Connection to a Ziblue / GCE RFPlayer RFP1000 through a serial-to-TCP bridge
  (ser2net, socat, ESP-Link…), with automatic reconnection and a PING
  keep-alive that notices an unplugged dongle.
- Devices heard on the air, offered in the Discovery screen: Oregon Scientific
  probes (temperature, humidity, pressure, wind, rain, UV), OWL energy meters,
  Visonic / X2D detectors (alarm, tamper, low battery), KD101 smoke detectors,
  and the remotes of every protocol the dongle decodes.
- Actuators driven by the dongle, declared in the configuration: switches,
  dimmable lights, Somfy RTS shutters (with the "my" button as stop) and
  buttons (gates, bells), on Chacon/DiO, X10, Blyss, RTS, X2D, Visonic, Parrot,
  KD101, FS20 and Edisio.
- "Pair an actuator" action: sends the pairing frame and adds the receiver to
  the configuration in one go.
- The dongle's jamming detector, as a device feature and a scene trigger.
- Scene triggers (Gladys 5.1+): a remote is pressed, a detector is triggered,
  a battery is low, a radio jamming starts or stops.
- Scene actions (Gladys 5.1+): send any radio order, simulate a jamming.
- "RFPlayer radio" dashboard widget: dongle status, jamming, last emitters
  heard and whether they are already devices in Gladys.
- Settings: protocols received, minimum radio quality (to ignore the
  neighbours), jamming threshold, Oregon probe identity, detector types.
- Transport badge `local` / `unreachable` on every device.
- The emitters heard are kept in `/data`, so the Discovery screen survives a
  restart.
- User documentation in English and French (`docs/`), `SECURITY.md`,
  `CLAUDE.md`, CI (format, lint, tests on Node 22 and 24, store checks, Docker
  build), UI-driven releases and Dependabot.

[Unreleased]: https://github.com/prohand/gladys-rfplayer/compare/v2.1.1...HEAD
[2.1.1]: https://github.com/prohand/gladys-rfplayer/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/prohand/gladys-rfplayer/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/prohand/gladys-rfplayer/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/prohand/gladys-rfplayer/releases/tag/v2.0.0
