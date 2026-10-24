# decaid-mqtt-plugin

> **Fork by [Co0p3r21](https://github.com/Co0p3r21/decaid-mqtt-plugin)** — based on the original plugin by [meldavy](https://github.com/meldavy/decaid-mqtt-plugin).  
> Adds **Home Assistant MQTT Auto-Discovery** and a customizable **Dashboard Action Button** for Streamline.

MQTT integration for [Decaid](https://github.com/decentespresso/decaid) —
publishes machine state to an MQTT broker and accepts control commands.
Wire-compatible with the de1app MQTT plugin
([simpkins/de1plus-mqtt](https://github.com/simpkins/de1plus-mqtt)), so
existing MQTT consumers (Home Assistant, Node-RED, custom scripts) keep
working unchanged.

Specs: [doc/protocol.md](doc/protocol.md) (wire contract),
[doc/architecture.md](doc/architecture.md) (implementation design).
Tracking: [decentespresso/decaid#681](https://github.com/decentespresso/decaid/issues/681).

## Features

- **Home Assistant MQTT Auto-Discovery**: Automatically configures entities in
  Home Assistant (temperature sensors, flow/pressure, shot active, power switch,
  steam switch, profile selector) with no YAML needed.
- **Dashboard Action Button**: Customizable quick-action button in the Streamline
  header bar to trigger Home Assistant automations with a single tap.
- Publishes machine state to `{topic_prefix}/state` (QoS 1, retained):
  temperatures, pressure, flow, state/substate, profile, usage counts, water
  level — the same 17-field JSON document as the de1app plugin.
- Live shot weight: with a scale attached, `shot_weight_g` updates in real
  time during a shot; the final yield, shot id, start time and duration are
  reported after completion. (Additive fields beyond de1app parity.)
- Subscribes to `{topic_prefix}/command` for `wake`, `sleep`, `steam_on`,
  `steam_off`, `profile <name>`, `profile_filename <file>`.
- MQTT over raw TCP or TLS (matching de1app, not MQTT-over-WebSocket).
- Auto-generated unique client ID and topic prefix so multiple machines never
  collide on one broker.
- Reconnect loop with exponential backoff (2 s doubling, capped at 64 s, 15
  attempts); MQTT last will publishes an explicit offline state document.

## Payloads

All state is published to `{topic_prefix}/state` as a single JSON document
(QoS 1, retained). Below, the auto-generated topic prefix
`de1plus/<unique_id>` is written as `de1plus/abcd1234`.

Machine awake and idle, no scale connected:

```json
{
  "online": true,
  "de1_connected": true,
  "scale_connected": false,
  "state": "Idle",
  "substate": "ready",
  "profile": "Medium",
  "profile_filename": "medium.tcl",
  "espresso_count": 1234,
  "steaming_count": 56,
  "head_temperature": 93.5,
  "mix_temperature": 92.1,
  "steam_heater_temperature": 24.0,
  "wake_state": true,
  "steam_mode": "Off",
  "steam_state": false,
  "water_level_mm": 58.0,
  "water_level_ml": 1808,
  "shot_active": false
}
```

During a shot with a scale connected (published ~1 s apart while pouring):

```json
{
  "online": true,
  "de1_connected": true,
  "scale_connected": true,
  "state": "Espresso",
  "substate": "pouring",
  "profile": "Medium",
  "profile_filename": "medium.tcl",
  "espresso_count": 1234,
  "steaming_count": 56,
  "head_temperature": 93.5,
  "mix_temperature": 92.1,
  "steam_heater_temperature": 24.0,
  "wake_state": true,
  "steam_mode": "Off",
  "steam_state": false,
  "water_level_mm": 57.0,
  "water_level_ml": 1808,
  "shot_active": true,
  "shot_weight_g": 18.4
}
```

After the shot completes, `shot_active` becomes `false` and the shot record
fills in (`shot_id`, `shot_started_at`, `shot_duration_s`, and
`shot_weight_g` as the final yield):

```json
{
  "online": true,
  "de1_connected": true,
  "scale_connected": true,
  "state": "Idle",
  "substate": "ready",
  "profile": "Medium",
  "profile_filename": "medium.tcl",
  "espresso_count": 1235,
  "steaming_count": 56,
  "head_temperature": 93.5,
  "mix_temperature": 92.1,
  "steam_heater_temperature": 24.0,
  "wake_state": true,
  "steam_mode": "Off",
  "steam_state": false,
  "water_level_mm": 57.0,
  "water_level_ml": 1808,
  "shot_active": false,
  "shot_id": "a1b2c3d4",
  "shot_started_at": "2026-09-12T13:14:15.000Z",
  "shot_duration_s": 27.5,
  "shot_weight_g": 36.2
}
```

Machine asleep, no scale, no shot history: the 17 de1app-compatible fields
plus `shot_active: false` (shot fields without values are omitted).

Machine link down or app dead (also the last-will payload, retained):

```json
{"online": false, "de1_connected": false}
```

When the machine is connected, all fields above are always present except the
shot record fields (`shot_id`, `shot_started_at`, `shot_duration_s`,
`shot_weight_g`), which appear after the first completed shot;
`shot_weight_g` additionally requires a scale. Full field reference:
[doc/protocol.md](doc/protocol.md#state-document-tstate).

### Commands

Send plain-text UTF-8 payloads to `{topic_prefix}/command`
(e.g. `de1plus/abcd1234/command`):

| Payload | Action |
|---------|--------|
| `wake` | Wake the machine |
| `sleep` | Put the machine to sleep |
| `steam_on` / `steam_off` | Toggle the steam heater |
| `profile <name>` | Select a profile by title, e.g. `profile Medium` |
| `profile_filename <file>` | Select a profile by filename, e.g. `profile_filename medium.tcl` |

Unknown payloads are logged and ignored.

### Dashboard button

The plugin can show a tappable quick-action button in the Streamline header bar
(next to Settings and Sleep). A tap silently publishes a fixed MQTT message that
triggers Home Assistant automations.

| Setting | Default | Meaning |
|---|---|---|
| Show dashboard button | off | Display the button in the header bar |
| Button label | 🔘 | Emoji or short text (max 24 characters) |

When enabled, the button appears directly in the header controls of Streamline.
A tap silently publishes `{"event_type":"press"}` to `{topic_prefix}/event` (QoS 1, **not** retained).

#### Home Assistant Integration

When **Enable HA Auto-Discovery** is on, Home Assistant automatically registers the button under your Decent Espresso device:
- **Device Trigger**: In the automation editor, choose **Trigger → Device → Decent Espresso DE1 → Button button_short_press**. No YAML required!
- **Event Entity**: `event.de1plus_<unique_id>_button` with event type `press`.

#### Automation example (YAML)

You can trigger automations directly using the auto-discovered event entity:

```yaml
alias: Turn on kitchen lights when Decaid button pressed
triggers:
  - trigger: state
    entity_id: event.de1plus_abcd1234_button
    to: ~
actions:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
mode: single
```

Or trigger from MQTT directly if Auto-Discovery is disabled:

```yaml
alias: Decaid MQTT button event
triggers:
  - trigger: mqtt
    topic: "de1plus/abcd1234/event"
actions:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
mode: single
```

## Install

### From a GitHub release (tracked, auto-updates)

* To install on your machine, go to plugin settings from the Decaid app, and install using github release `Co0p3r21/decaid-mqtt-plugin`.

```
POST http://<tablet>:8080/api/v1/plugins/install/github-release
{"repo": "Co0p3r21/decaid-mqtt-plugin"}
```

or use the Plugins settings screen in Decaid.

### From a branch (tracked, updates on commit)

```
POST http://<tablet>:8080/api/v1/plugins/install/github-branch
{"repo": "Co0p3r21/decaid-mqtt-plugin"}
```

### From a local build

Zip the `mqtt.reaplugin/` directory and install it from the Plugins settings
screen (local ZIP), or copy it into the app's plugin folder.

## Compatibility

- Requires Decaid **0.8.5 or later** (that is the first stable release with
  the plugin `host.transport` network permissions this plugin needs).
- The manifest deliberately does not request `events.workflow` (0.8.6+ only);
  instead the current profile title is polled from `GET /api/v1/workflow` on
  the heartbeat cadence, so `profile`/`profile_filename` stay correct on both
  0.8.5 and newer builds. After a `profile`/`profile_filename` command the
  state is re-polled immediately.
- The manifest carries explicit empty `api` and `drivers` arrays because
  Decaid's manifest parser requires a (possibly empty) list for `api`.
- On 0.8.5 the broker password is stored in regular settings storage; secure
  credential storage arrives with later Decaid versions (`secure: true` is
  already declared).

## Settings

Configured in Decaid's plugin settings screen:

| Setting | Default | Meaning |
|---------|---------|---------|
| Broker host | *(empty)* | Empty disables the integration |
| Broker port | 8883 | 8883 for TLS, 1883 for plain TCP |
| Username / Password | *(empty)* | Broker credentials; password stored securely |
| Client ID | auto | `de1plus_<unique id>` when empty |
| Topic prefix | auto | `de1plus/<unique id>` when empty |
| Publish interval (ms) | 60000 | Idle heartbeat; mid-shot updates publish at ~1 s |
| Use TLS | on | Platform certificate validation |
| Enable HA Auto-Discovery | off | Publish Home Assistant MQTT discovery entities on connect |
| Show dashboard button | off | Show a tappable button on the Streamline dashboard |
| Button label | 🔘 | Emoji or short text for the button (max 24 characters) |

Custom CA / mutual TLS is not supported yet — it depends on the plugin
transport gaining custom trust material
([decaid#758](https://github.com/decentespresso/decaid/issues/758)).

## Development

```
npm install
npm run build       # bundles src/ + mqtt.js into mqtt.reaplugin/plugin.js
npm test            # unit tests (no broker or sockets required)
npm run test:integ  # end-to-end integration tests (~2 min, real sockets)
```

### Integration tests

`npm run test:integ` is a separate build target from `npm test`. It runs the
**built** `mqtt.reaplugin/plugin.js` bundle inside a sandboxed VM that mirrors
the Decaid plugin runtime (`host.transport` over real TCP sockets, host-owned
`fetch`, async `storageRead` events, permission gating, transport limits)
against a purpose-built in-process MQTT broker (MQTT 3.1.1 and 5, retained
messages, last will, QoS 1, auth) and a simulated Decaid REST/WebSocket API on
a real loopback HTTP server. No external broker, machine or app instance is
required; everything runs on ephemeral localhost ports, so it works in any
developer environment and in CI.

The suite covers: broker handshake (client id, keepalive, will, MQTT 5 with
3.1.1 fallback), state document wire format and publish triggers, heartbeat
cadence, live shot weight over the scale stream, shot completion records,
water levels, profile selection, all six commands, unknown/invalid commands,
broker outage and restart reconnects, last-will offline documents on abnormal
client death, unload teardown, broker authentication, HA auto-discovery
publishing and retraction, and the dashboard button skin/trigger endpoints.

CI runs `npm test` only. It is the developer's responsibility to run
`npm run test:integ` before checking in changes that affect the plugin's
runtime behavior (`src/`, `build.mjs`, or the bundle).

The built `plugin.js` is committed so branch installs work; CI verifies it is
up to date and repackages it for releases. Tag a release `vX.Y.Z` matching
`manifest.json`'s `version`.

### Status and known limitations

- The `host.transport` → MQTT.js adapter (`src/host-transport-stream.js`,
  `src/bridge.js`) is exercised end-to-end by `npm run test:integ` against a
  real in-process broker over real TCP sockets. On-device TLS (platform trust
  store) is not covered by the harness; everything else runs the shipping
  bundle.
- Home Assistant auto-discovery is intentionally out of scope for the first
  release (see doc/protocol.md); the state document is already compatible.
- Commands execute through Decaid's own REST API over loopback HTTP (same
  pattern as the bundled Visualizer plugin).

## License

MIT
