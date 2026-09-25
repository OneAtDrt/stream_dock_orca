# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org).

## [v0.3.1](https://github.com/OneAtDrt/stream_dock_orca/releases/tag/v0.3.1) — Single-limit layout

### Changed
* AI Limits: a provider with a single limit window (e.g. ChatGPT with only a weekly limit) gets a centred layout on its detail page (big number, thick full-width bar, reset time) instead of one small row in a mostly empty key
* Files: `plugin/render.js`, `CHANGELOG.md`; version 0.3.1 in `manifest.json`, `package.json`, `package-lock.json`

## [v0.3.0](https://github.com/OneAtDrt/stream_dock_orca/releases/tag/v0.3.0) — AI Limits, main text setting, live status

### Added
* **AI Limits** action (knob or key): Claude and ChatGPT limits left, with the 5-hour session countdown, 5-hour / weekly bars and Claude's separate Fable weekly limit; read from Orca's own `rateLimits` (no Keychain, no extra API calls); knob ring = colour of the lowest provider ([9700321](https://github.com/OneAtDrt/stream_dock_orca/commit/9700321a7f0799914c392b80d1337492bf85aca0))
* AI Limits pages: press cycles overview → Claude → ChatGPT; keys use their own full-size 144×144 layouts (big numbers, bigger rows when a provider has fewer windows) ([9700321](https://github.com/OneAtDrt/stream_dock_orca/commit/9700321a7f0799914c392b80d1337492bf85aca0))
* **Main text** setting (Property Inspector, shared by all Orca Agent keys): Auto / Chat name / Repository; Auto shows the chat name when several agents share a repository ([9700321](https://github.com/OneAtDrt/stream_dock_orca/commit/9700321a7f0799914c392b80d1337492bf85aca0))

* README previews: AI Limits pages and a chat-name key (`scripts/previews.js`) ([9700321](https://github.com/OneAtDrt/stream_dock_orca/commit/9700321a7f0799914c392b80d1337492bf85aca0))
### Fixed
* Agents whose Orca hook entries went stale showed as idle while working: a busy terminal title now wins, and a spinner → `✳` change seen by the plugin shows DONE for 30 min ([9700321](https://github.com/OneAtDrt/stream_dock_orca/commit/9700321a7f0799914c392b80d1337492bf85aca0))
* Files: `plugin/limits.js` (new), `plugin/limits.test.js` (new), `plugin/knob-led.js` (new, shared), `plugin/knob-led.test.js` (new), `plugin/agents.js`, `plugin/render.js`, `plugin/index.js`, `plugin/agents.test.js`, `propertyInspector/` (new), `static/limits.svg` (new), `manifest.json`, `package.json` (node-hid), `install.sh`, `scripts/previews.js`, `docs/previews/*.png`, `README.md`; version 0.3.0 in `manifest.json`, `package.json`, `package-lock.json` ([9700321](https://github.com/OneAtDrt/stream_dock_orca/commit/9700321a7f0799914c392b80d1337492bf85aca0))
* Tests: 22 ([9700321](https://github.com/OneAtDrt/stream_dock_orca/commit/9700321a7f0799914c392b80d1337492bf85aca0))

## [v0.2.2](https://github.com/OneAtDrt/stream_dock_orca/releases/tag/v0.2.2) — README previews

### Added
* README: preview images of every state (`scripts/previews.js`) ([04e27e7](https://github.com/OneAtDrt/stream_dock_orca/commit/04e27e718045ef2f4cf746a57cb01834d4197f67))
* Files: `scripts/previews.js` (new), `docs/previews/*.png` (new), `README.md`; version 0.2.2 in `manifest.json`, `package.json`, `package-lock.json` ([04e27e7](https://github.com/OneAtDrt/stream_dock_orca/commit/04e27e718045ef2f4cf746a57cb01834d4197f67))

## [v0.2.1](https://github.com/OneAtDrt/stream_dock_orca/releases/tag/v0.2.1) — Subagent live view

### Fixed
* Pressing a subagent key opened the main agent's terminal instead of the subagent. It now opens (or re-focuses) an Orca terminal tab `↳ <type> <id>` that follows the subagent's transcript live: task, messages, tool calls and shortened results. It falls back to the main agent's terminal if the view can't be opened ([6eb1b17](https://github.com/OneAtDrt/stream_dock_orca/commit/6eb1b17dfd338e08dce3c6095bdfb032d1d54628))
* Files: `plugin/subagent-view.js` (new), `plugin/agents.js`, `plugin/index.js`, `plugin/agents.test.js`, `README.md`, version 0.2.1 in `manifest.json`, `package.json`, `package-lock.json` ([6eb1b17](https://github.com/OneAtDrt/stream_dock_orca/commit/6eb1b17dfd338e08dce3c6095bdfb032d1d54628))
* Tests: 14 (added: subagent transcript paths, shell quoting, transcript formatting) ([6eb1b17](https://github.com/OneAtDrt/stream_dock_orca/commit/6eb1b17dfd338e08dce3c6095bdfb032d1d54628))

## [v0.2.0](https://github.com/OneAtDrt/stream_dock_orca/releases/tag/v0.2.0) — Subagent keys

* **Subagents on their own keys:** every running subagent gets its own **Orca Agent** key, placed right after its main agent (main A, A's subagents, main B, ...). Subagent keys show `↳ SUB i/n`, age, subagent type, description (up to 3 lines) and the parent's project, with a dashed border and darker fill; pressing one opens the parent's terminal ([bdb1bdf](https://github.com/OneAtDrt/stream_dock_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Main agents keep the priority order (waiting → working → done → idle); subagents stay attached to their parent, oldest first, and their keys disappear when they finish ([bdb1bdf](https://github.com/OneAtDrt/stream_dock_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Main agent keys show a small fork badge with their running subagent count ([bdb1bdf](https://github.com/OneAtDrt/stream_dock_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Source: Orca's per-pane subagent roster (`payload.subagents` in `last-status.json`), `working` / `blocked` / `waiting` entries only; ignored when the entry is older than 30 min ([bdb1bdf](https://github.com/OneAtDrt/stream_dock_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Descriptions come from Orca's roster or from Claude Code's `<session>/subagents/agent-<id>.meta.json`, cached per file ([bdb1bdf](https://github.com/OneAtDrt/stream_dock_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* New **SUBS ×n** status (indigo, fork icon) for a main agent whose own turn is over while its subagents still run; age counts from the oldest subagent. WORKING when the main agent is busy itself (its own mid-turn hook event or a spinner title), WAITING still wins. Sorts with working agents; the Summary key counts it under WORKING and still counts main agents only ([bdb1bdf](https://github.com/OneAtDrt/stream_dock_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Tests: roster parsing, meta path, SUBS status, slot flattening and order, subagent removal, subagent/badge rendering (11 tests) ([bdb1bdf](https://github.com/OneAtDrt/stream_dock_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Files: `plugin/agents.js`, `plugin/render.js`, `plugin/index.js`, `plugin/agents.test.js`, `README.md` ([bdb1bdf](https://github.com/OneAtDrt/stream_dock_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))

## [v0.1.0](https://github.com/OneAtDrt/stream_dock_orca/releases/tag/v0.1.0) — Initial release

* **Orca Agent** key action: one live Orca agent per key (status + age, agent type, project, task title); press to switch to its terminal in Orca
* **Orca Summary** key action: counts of waiting / working / done agents; press to jump to the agent that needs you
* Status from Orca agent hooks (`last-status.json`) joined with `orca terminal list`, falling back to the Claude Code title spinner; done fades to idle after 30 min
* Priority ordering (waiting → working → done → idle), per-key slot numbers persisted in key settings
* `install.sh` installer, unit tests (`node --test`) ([39d4045](https://github.com/OneAtDrt/stream_dock_orca/commit/39d40454b57b98105e515973f8fb5145ed2f72dd))
* Files: `com.oneatdrt.orca-agents.sdPlugin/manifest.json`, `plugin/index.js`, `plugin/agents.js`, `plugin/render.js`, `plugin/agents.test.js`, `static/icon.svg`, `install.sh`, `README.md`
