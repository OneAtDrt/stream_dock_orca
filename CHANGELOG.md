# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org).

## [v0.1.0](https://github.com/OneAtDrt/stream_deck_orca/releases/tag/v0.1.0) — Initial release

* **Orca Agent** key action: one live Orca agent per key (status + age, agent type, project, task title); press to switch to its terminal in Orca
* **Orca Summary** key action: counts of waiting / working / done agents; press to jump to the agent that needs you
* Status from Orca agent hooks (`last-status.json`) joined with `orca terminal list`, falling back to the Claude Code title spinner; done fades to idle after 30 min
* Priority ordering (waiting → working → done → idle), per-key slot numbers persisted in key settings
* `install.sh` installer, unit tests (`node --test`)
* Files: `com.oneatdrt.orca-agents.sdPlugin/manifest.json`, `plugin/index.js`, `plugin/agents.js`, `plugin/render.js`, `plugin/agents.test.js`, `static/icon.svg`, `install.sh`, `README.md`
