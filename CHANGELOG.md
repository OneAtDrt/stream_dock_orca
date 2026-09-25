# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org).

## [v0.2.1](https://github.com/OneAtDrt/stream_deck_orca/releases/tag/v0.2.1) — Subagent live view

### Fixed
* Pressing a subagent key opened the main agent's terminal instead of the subagent. It now opens (or re-focuses) an Orca terminal tab `↳ <type> <id>` that follows the subagent's transcript live: task, messages, tool calls and shortened results. It falls back to the main agent's terminal if the view can't be opened
* Files: `plugin/subagent-view.js` (new), `plugin/agents.js`, `plugin/index.js`, `plugin/agents.test.js`, `README.md`, version 0.2.1 in `manifest.json`, `package.json`, `package-lock.json`
* Tests: 14 (added: subagent transcript paths, shell quoting, transcript formatting)

## [v0.2.0](https://github.com/OneAtDrt/stream_deck_orca/releases/tag/v0.2.0) — Subagent keys

* **Subagents on their own keys:** every running subagent gets its own **Orca Agent** key, placed right after its main agent (main A, A's subagents, main B, ...). Subagent keys show `↳ SUB i/n`, age, subagent type, description (up to 3 lines) and the parent's project, with a dashed border and darker fill; pressing one opens the parent's terminal ([bdb1bdf](https://github.com/OneAtDrt/stream_deck_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Main agents keep the priority order (waiting → working → done → idle); subagents stay attached to their parent, oldest first, and their keys disappear when they finish ([bdb1bdf](https://github.com/OneAtDrt/stream_deck_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Main agent keys show a small fork badge with their running subagent count ([bdb1bdf](https://github.com/OneAtDrt/stream_deck_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Source: Orca's per-pane subagent roster (`payload.subagents` in `last-status.json`), `working` / `blocked` / `waiting` entries only; ignored when the entry is older than 30 min ([bdb1bdf](https://github.com/OneAtDrt/stream_deck_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Descriptions come from Orca's roster or from Claude Code's `<session>/subagents/agent-<id>.meta.json`, cached per file ([bdb1bdf](https://github.com/OneAtDrt/stream_deck_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* New **SUBS ×n** status (indigo, fork icon) for a main agent whose own turn is over while its subagents still run; age counts from the oldest subagent. WORKING when the main agent is busy itself (its own mid-turn hook event or a spinner title), WAITING still wins. Sorts with working agents; the Summary key counts it under WORKING and still counts main agents only ([bdb1bdf](https://github.com/OneAtDrt/stream_deck_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Tests: roster parsing, meta path, SUBS status, slot flattening and order, subagent removal, subagent/badge rendering (11 tests) ([bdb1bdf](https://github.com/OneAtDrt/stream_deck_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))
* Files: `plugin/agents.js`, `plugin/render.js`, `plugin/index.js`, `plugin/agents.test.js`, `README.md` ([bdb1bdf](https://github.com/OneAtDrt/stream_deck_orca/commit/bdb1bdf89be2fca27dc2b96198d6093f1462ebb2))

## [v0.1.0](https://github.com/OneAtDrt/stream_deck_orca/releases/tag/v0.1.0) — Initial release

* **Orca Agent** key action: one live Orca agent per key (status + age, agent type, project, task title); press to switch to its terminal in Orca
* **Orca Summary** key action: counts of waiting / working / done agents; press to jump to the agent that needs you
* Status from Orca agent hooks (`last-status.json`) joined with `orca terminal list`, falling back to the Claude Code title spinner; done fades to idle after 30 min
* Priority ordering (waiting → working → done → idle), per-key slot numbers persisted in key settings
* `install.sh` installer, unit tests (`node --test`) ([39d4045](https://github.com/OneAtDrt/stream_deck_orca/commit/39d40454b57b98105e515973f8fb5145ed2f72dd))
* Files: `com.oneatdrt.orca-agents.sdPlugin/manifest.json`, `plugin/index.js`, `plugin/agents.js`, `plugin/render.js`, `plugin/agents.test.js`, `static/icon.svg`, `install.sh`, `README.md`
