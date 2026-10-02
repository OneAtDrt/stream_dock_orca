'use strict';

// Live Claude Code state, independent of Orca's hook entries (which go stale for some sessions,
// e.g. background sessions an Orca terminal only displays). Claude Code keeps one file per running
// process in <config>/sessions/<pid>.json with the session id, cwd, name and busy/idle status, and
// writes each subagent's transcript to <config>/projects/<cwd>/<session>/subagents/agent-<id>.jsonl.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// A subagent whose transcript hasn't been written for this long is treated as finished.
const SUBAGENT_ACTIVE_MS = 3 * 60 * 1000;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

async function readSessions(dir = path.join(CONFIG_DIR, 'sessions'), alive = isAlive) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const sessions = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const s = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      if (s && s.sessionId && s.cwd && alive(s.pid)) sessions.push(s);
    } catch {
      // Being rewritten or unreadable: skip this round.
    }
  }
  return sessions;
}

// Claude Code's project folder name: the cwd with every non-alphanumeric character as "-".
function projectDir(cwd, configDir = CONFIG_DIR) {
  return path.join(configDir, 'projects', String(cwd).replace(/[^A-Za-z0-9]/g, '-'));
}

// The live session an Orca terminal shows: same folder and the same name as the terminal's task
// title; if that folder has exactly one live session, that one.
function matchSession(terminal, taskName, sessions) {
  const here = sessions.filter((s) => s.cwd === terminal.worktreePath);
  const name = String(taskName || '').trim();
  return here.find((s) => name && String(s.name || '').trim() === name) || (here.length === 1 ? here[0] : null);
}

async function liveSubagents(session, now = Date.now(), configDir = CONFIG_DIR) {
  const dir = path.join(projectDir(session.cwd, configDir), session.sessionId, 'subagents');
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const subs = [];
  for (const name of names) {
    const m = /^agent-(.+)\.jsonl$/.exec(name);
    if (!m) continue;
    let stat;
    try {
      stat = await fs.stat(path.join(dir, name));
    } catch {
      continue;
    }
    if (now - stat.mtimeMs > SUBAGENT_ACTIVE_MS) continue;
    let meta = {};
    try {
      meta = JSON.parse(await fs.readFile(path.join(dir, `agent-${m[1]}.meta.json`), 'utf8'));
    } catch {
      // No meta yet: show the id.
    }
    subs.push({
      id: m[1],
      state: 'working',
      agentType: meta.agentType || meta.name || '',
      description: String(meta.description || '').replace(/\s+/g, ' ').trim(),
      startedAt: stat.birthtimeMs || stat.ctimeMs
    });
  }
  return subs.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

// handle -> { busy, status, statusAt, transcriptPath, subagents } for Claude terminals that have a live
// session. status: Claude Code's own "busy" / "idle" / "waiting" (a dialog such as a permission
// prompt is open); statusAt: when it last changed.
async function liveClaudeState(terminals, taskName, now = Date.now()) {
  const sessions = await readSessions();
  const out = {};
  for (const t of terminals) {
    if (t.agentIdentity !== 'claude') continue;
    const s = matchSession(t, taskName(t), sessions);
    if (!s) continue;
    out[t.handle] = {
      busy: s.status === 'busy',
      status: s.status,
      statusAt: s.statusUpdatedAt || s.updatedAt || 0,
      transcriptPath: path.join(projectDir(s.cwd), `${s.sessionId}.jsonl`),
      subagents: await liveSubagents(s, now)
    };
  }
  return out;
}

module.exports = { readSessions, projectDir, matchSession, liveSubagents, liveClaudeState, SUBAGENT_ACTIVE_MS };
