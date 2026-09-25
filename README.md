# Stream Dock Orca Agents

> **macOS only.** The plugin reads Orca's macOS data folder, calls the Orca CLI from the macOS app bundle, and ships only a macOS build.

A [Mirabox Stream Dock](https://mirabox.net) plugin that shows the live status of your [Orca](https://orca.stably.ai) AI agents (Claude Code, Codex, ...) on Stream Dock keys. Press a key to jump to that agent's terminal in Orca.

## Actions

| Action | Shows | Press |
|---|---|---|
| **Orca Agent** | One agent: its status and how long it's been in it, agent type, project, task title | Opens that agent's terminal in Orca |
| **Orca Summary** | Total agents, plus how many are waiting, working or done | Jumps to the first agent that needs you (then done, then working) |

### Status colours

| Status | Colour | Meaning |
|---|---|---|
| **WAITING** | amber, blinking border | The agent needs your input or permission |
| **WORKING** | blue | The agent is busy |
| **DONE** | green | The agent finished a turn in the last 30 min |
| **IDLE** | grey | Nothing happening |

Agent keys fill in priority order: waiting, working, done, idle. Each **Orca Agent** key gets a slot number when you first place it (1st key = slot 1, 2nd = slot 2, ...). The number is saved with the key.

## Requirements

- macOS
- [Orca](https://orca.stably.ai) installed in `/Applications/Orca.app` and running
- Stream Dock app 3.10.191 or newer. It runs the plugin with its built-in Node 20.
- Any Stream Dock device with keys. The layout was designed on an N4 Pro.
- Node.js / npm, used by `install.sh` to install dependencies.

## Install

```sh
git clone https://github.com/OneAtDrt/stream_deck_orca.git
cd stream_deck_orca
./install.sh
```

`install.sh` does three things:
1. Installs dependencies.
2. Copies `com.oneatdrt.orca-agents.sdPlugin` into `~/Library/Application Support/HotSpot/StreamDock/plugins/`.
3. Restarts Stream Dock.

Then, in Stream Dock, drag the actions from the **Orca Agents** category onto your keys.

To update, pull and run `./install.sh` again.

## How it works

Every 2 s the plugin reads two sources:

1. **`orca terminal list --json`:** the live Orca terminals that have an agent (`agentIdentity`).
2. **`~/Library/Application Support/orca/agent-hooks/last-status.json`:** the latest agent hook state for each pane, matched to terminals by `tabId:leafId`.

If a pane has no hook entry, the plugin uses the first character of the Claude Code terminal title instead. A spinner means working and `✳` means idle.

Pressing a key runs `orca terminal switch --terminal <handle>` and brings Orca to the front. The plugin never reads Orca's auth token.

Overrides (environment variables): `ORCA_BIN`, `ORCA_HOOK_STATUS_FILE`.

## Project structure

| File | Purpose |
|---|---|
| `com.oneatdrt.orca-agents.sdPlugin/manifest.json` | Stream Dock manifest (2 actions) |
| `plugin/index.js` | Stream Dock WebSocket wiring, key slots, refresh loop |
| `plugin/agents.js` | Orca data loading, status logic, sorting, switching to a terminal |
| `plugin/render.js` | 144×144 SVG key images |
| `plugin/agents.test.js` | Unit tests |
| `install.sh` | Installs the plugin into Stream Dock and restarts it |

## Development

```sh
cd com.oneatdrt.orca-agents.sdPlugin/plugin
npm install
npm test
```

The plugin writes its log to `plugin/log/plugin.log` inside the installed plugin folder.

## Version history

See [CHANGELOG.md](./CHANGELOG.md).
