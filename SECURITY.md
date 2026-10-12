# Security policy

## Supported versions

Only the latest release of the RFPlayer integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue, pull request or forum post for a
security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-rfplayer](https://github.com/prohand/gladys-rfplayer/security),
then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove tokens, addresses and radio identifiers
  first).

You should get a first answer within 7 days. A fix is released as a new version
of the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes —
in particular the commands it writes to the dongle (a scene or a setting must
never be able to send anything but a validated radio order).

Out of scope:

- Gladys Assistant itself (report to
  [GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security));
- the RFPlayer firmware, and the radio protocols themselves: most 433/868 MHz
  protocols (Chacon/DiO, X10, Blyss, Oregon…) have no encryption nor
  authentication, anyone nearby can listen to them or replay them. That is a
  property of the hardware, not a flaw of this integration;
- the serial-to-TCP bridge you run (ser2net, socat…).

## Good practices for users

- The serial-to-TCP bridge has **no authentication**: anyone who can reach its
  port can drive your radio devices. Bind it to the LAN only (or to the Gladys
  host IP), never expose it to the Internet, and firewall it if you can.
- Do not drive security-critical equipment (alarm arming, door locks) with
  unauthenticated protocols such as Chacon/DiO or X10.
- Turn on the jamming detection and build a scene on the "Radio jamming"
  trigger if you rely on wireless detectors.
- Keep Gladys and the integration up to date.
