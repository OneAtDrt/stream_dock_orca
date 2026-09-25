'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ORCA_BIN = process.env.ORCA_BIN || '/Applications/Orca.app/Contents/Resources/bin/orca';
const HOOK_STATUS_FILE = process.env.ORCA_HOOK_STATUS_FILE
  || path.join(os.homedir(), 'Library/Application Support/orca/agent-hooks/last-status.json');

// A finished turn stays "done" (green) this long, then fades to "idle" (grey).
const DONE_FADE_MS = 30 * 60 * 1000;

const STATUS_ORDER = { waiting: 0, working: 1, done: 2, idle: 3 };

// Claude Code prefixes its terminal title with a spinner glyph while busy and ✳ when idle.
const IDLE_GLYPHS = new Set(['✳']);
const BUSY_GLYPH = /^[⠀-⣿◐◑◒◓·✢✶✻✽*]/;

function runOrca(args, timeout = 5000) {
  return new Promise((resolve, reject) => {
    execFile(ORCA_BIN, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout);
    });
  });
}

async function listTerminals() {
  const out = await runOrca(['terminal', 'list', '--json']);
  const json = JSON.parse(out);
  if (!json.ok) throw new Error(`orca terminal list failed: ${out.slice(0, 200)}`);
  return json.result?.terminals || [];
}

async function readHookStatus() {
  try {
    const json = JSON.parse(await fs.readFile(HOOK_STATUS_FILE, 'utf8'));
    return json.entries || {};
  } catch {
    return {};
  }
}

function deriveStatus(terminal, hook, now) {
  const state = hook?.payload?.state;
  if (state === 'working') return 'working';
  if (state === 'blocked' || state === 'waiting' || state === 'permission') return 'waiting';
  if (state === 'done') {
    if (hook.hookEventName === 'SessionStart') return 'idle';
    return now - (hook.stateStartedAt || hook.receivedAt || 0) < DONE_FADE_MS ? 'done' : 'idle';
  }

  const glyph = [...(terminal.title || '')][0] || '';
  if (!IDLE_GLYPHS.has(glyph) && BUSY_GLYPH.test(glyph)) return 'working';
  return 'idle';
}

function projectLabel(worktreePath) {
  if (!worktreePath) return '?';
  const parts = worktreePath.split('/').filter(Boolean);
  const ws = parts.lastIndexOf('workspaces');
  // Orca / Conductor workspaces look like .../workspaces/<repo>/<workspace-name>
  if (ws !== -1 && parts.length >= ws + 3) return parts[ws + 1];
  return parts[parts.length - 1];
}

function workspaceLabel(worktreePath) {
  const parts = (worktreePath || '').split('/').filter(Boolean);
  const ws = parts.lastIndexOf('workspaces');
  if (ws !== -1 && parts.length >= ws + 3) return parts[parts.length - 1];
  return '';
}

function taskLabel(terminal, hook) {
  const title = [...(terminal.title || '')];
  if (title.length && (IDLE_GLYPHS.has(title[0]) || BUSY_GLYPH.test(title[0]))) title.shift();
  const text = title.join('').trim();
  if (text) return text;
  return (hook?.payload?.prompt || '').replace(/\s+/g, ' ').trim();
}

function buildAgents(terminals, hookEntries, now = Date.now()) {
  const agents = [];
  for (const terminal of terminals) {
    if (!terminal.agentIdentity || terminal.orphaned || terminal.connected === false) continue;
    const hook = hookEntries[`${terminal.tabId}:${terminal.leafId}`];
    const status = deriveStatus(terminal, hook, now);
    const since = hook?.stateStartedAt || hook?.receivedAt || terminal.lastOutputAt || now;
    agents.push({
      handle: terminal.handle,
      agent: terminal.agentIdentity,
      project: projectLabel(terminal.worktreePath),
      workspace: workspaceLabel(terminal.worktreePath),
      task: taskLabel(terminal, hook),
      status,
      since,
      lastActivity: Math.max(hook?.receivedAt || 0, terminal.lastOutputAt || 0)
    });
  }

  // Needs-you first, then busy agents (oldest first, so keys stay put), then recently finished.
  agents.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus) return byStatus;
    if (a.status === 'waiting' || a.status === 'working') return a.since - b.since || a.handle.localeCompare(b.handle);
    return b.lastActivity - a.lastActivity || a.handle.localeCompare(b.handle);
  });
  return agents;
}

async function loadAgents() {
  const [terminals, hooks] = await Promise.all([listTerminals(), readHookStatus()]);
  return buildAgents(terminals, hooks);
}

async function focusAgent(handle) {
  await runOrca(['terminal', 'switch', '--terminal', handle, '--json']);
  await new Promise((resolve) => execFile('/usr/bin/open', ['-a', 'Orca'], () => resolve()));
}

module.exports = { loadAgents, buildAgents, deriveStatus, projectLabel, taskLabel, focusAgent, DONE_FADE_MS };
