'use strict';

// Live Claude Code state, independent of Orca's hook entries (which go stale for some sessions,
// e.g. background sessions an Orca terminal only displays). Claude Code keeps one file per running
// process in <config>/sessions/<pid>.json with the session id, cwd, name and busy/idle status, and
// writes each subagent's transcript to <config>/projects/<cwd>/<session>/subagents/agent-<id>.jsonl.

const { execFile } = require('node:child_process');
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

// The live session an Orca terminal shows: the session id from Orca's hook entry when there is one;
// else same folder and the same name as the terminal's task title; else the folder's only session.
// (A session's auto name, e.g. "paris-82", often differs from the chat title.)
function matchSession(terminal, taskName, sessions, sessionId = null) {
  const byId = sessionId && sessions.find((s) => s.sessionId === sessionId);
  if (byId) return byId;
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

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => (error && !stdout ? reject(error) : resolve(String(stdout))));
  });
}

// Claude Code runs every command as a child "zsh -c source …/shell-snapshots/…". While a session is
// "shell" (its turn is over but background tasks run), each such child is a background task: one
// writing to <tmp>/…/tasks/<id>.output is a background shell, one streaming into Claude (a pipe or
// socket) is a monitor. -> { [claude pid]: { shells, monitors } }
function countBackground(psText, lsofText, pids) {
  const owner = new Map();
  for (const line of String(psText).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m && pids.includes(Number(m[2])) && m[3].includes('/shell-snapshots/')) owner.set(Number(m[1]), Number(m[2]));
  }
  const out = {};
  for (const pid of pids) out[pid] = { shells: 0, monitors: 0 };
  let current = null;
  const toFile = new Set();
  for (const line of String(lsofText).split('\n')) {
    if (line.startsWith('p')) current = Number(line.slice(1));
    else if (line.startsWith('n') && /\/tasks\/[^/]+\.output$/.test(line)) toFile.add(current);
  }
  for (const [child, parent] of owner) out[parent][toFile.has(child) ? 'shells' : 'monitors'] += 1;
  return out;
}

async function backgroundTasks(pids) {
  if (!pids.length) return {};
  const ps = await run('/bin/ps', ['-axo', 'pid=,ppid=,command=']);
  const children = [...ps.matchAll(/^\s*(\d+)\s+(\d+)\s+.*\/shell-snapshots\//gm)].filter((m) => pids.includes(Number(m[2]))).map((m) => m[1]);
  const lsof = children.length ? await run('/usr/sbin/lsof', ['-a', '-d', '1', '-Fpn', '-p', children.join(',')]).catch(() => '') : '';
  return countBackground(ps, lsof, pids);
}

// handle -> { busy, status, statusAt, background, transcriptPath, subagents } for Claude terminals that
// have a live session. status: Claude Code's own "busy" / "shell" (turn over, background tasks
// running) / "idle" / "waiting" (a dialog such as a permission prompt is open); statusAt: when it
// last changed; background: { shells, monitors } while "shell".
// sessionIdOf(terminal): the Claude session id Orca knows for the terminal, if any.
async function liveClaudeState(terminals, taskName, now = Date.now(), sessionIdOf = () => null) {
  const sessions = await readSessions();
  const out = {};
  const matched = [];
  for (const t of terminals) {
    if (t.agentIdentity !== 'claude') continue;
    const s = matchSession(t, taskName(t), sessions, sessionIdOf(t));
    if (!s) continue;
    matched.push([t, s]);
    out[t.handle] = {
      busy: s.status === 'busy',
      status: s.status,
      statusAt: s.statusUpdatedAt || s.updatedAt || 0,
      background: null,
      transcriptPath: path.join(projectDir(s.cwd), `${s.sessionId}.jsonl`),
      subagents: await liveSubagents(s, now)
    };
  }
  const shellPids = matched.filter(([, s]) => s.status === 'shell').map(([, s]) => s.pid);
  const counts = await backgroundTasks(shellPids).catch(() => ({}));
  for (const [t, s] of matched) if (s.status === 'shell') out[t.handle].background = counts[s.pid] || { shells: 0, monitors: 0 };
  return out;
}

module.exports = { readSessions, projectDir, matchSession, liveSubagents, liveClaudeState, countBackground, backgroundTasks, SUBAGENT_ACTIVE_MS };
