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

// "subagents": the main agent's own turn is over but its subagents are still running.
const STATUS_ORDER = { waiting: 0, working: 1, subagents: 1, done: 2, idle: 3 };

// Hook events from the main agent itself (no toolAgentId) that mean it is still mid-turn.
const LEAD_BUSY_EVENTS = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

// Orca's per-pane subagent roster states that mean the subagent is still running.
const RUNNING_SUBAGENT_STATES = new Set(['working', 'blocked', 'waiting']);
// Subagent tool calls refresh the parent pane's hook entry, so an entry this old means the roster is stale.
const SUBAGENT_STALE_MS = 30 * 60 * 1000;

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

// Meta files never change once written, so successful reads are cached by path.
const subagentMetaCache = new Map();

async function readSubagentMeta(hookEntries) {
  const meta = {};
  const seen = new Set();
  for (const hook of Object.values(hookEntries)) {
    for (const s of hook?.payload?.subagents || []) {
      if (!s?.id || s.description || !RUNNING_SUBAGENT_STATES.has(s.state)) continue;
      const file = subagentMetaPath(hook.providerSession?.transcriptPath, s.id);
      if (!file) continue;
      seen.add(file);
      if (!subagentMetaCache.has(file)) {
        try {
          const json = JSON.parse(await fs.readFile(file, 'utf8'));
          subagentMetaCache.set(file, { description: typeof json.description === 'string' ? json.description : '' });
        } catch {
          continue; // not written yet; retry next refresh
        }
      }
      meta[s.id] = subagentMetaCache.get(file);
    }
  }
  for (const file of subagentMetaCache.keys()) if (!seen.has(file)) subagentMetaCache.delete(file);
  return meta;
}

async function readHookStatus() {
  try {
    const json = JSON.parse(await fs.readFile(HOOK_STATUS_FILE, 'utf8'));
    return json.entries || {};
  } catch {
    return {};
  }
}

// Claude Code keeps each subagent's metadata (incl. the Task description) next to the session transcript:
// <session>.jsonl -> <session>/subagents/agent-<id>.meta.json
// Claude Code keeps a subagent's files next to the parent session: <session>/subagents/agent-<id>.*
function subagentFile(transcriptPath, id, ext) {
  if (!transcriptPath || !/\.jsonl$/.test(transcriptPath) || !/^[\w.-]+$/.test(String(id || ''))) return null;
  return path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents', `agent-${id}${ext}`);
}

function subagentTranscriptPath(transcriptPath, id) {
  return subagentFile(transcriptPath, id, '.jsonl');
}

function subagentMetaPath(transcriptPath, id) {
  return subagentFile(transcriptPath, id, '.meta.json');
}

// Running subagents from Orca's roster (payload.subagents), oldest first.
function activeSubagents(hook, now, meta = {}) {
  const roster = hook?.payload?.subagents;
  if (!Array.isArray(roster) || !roster.length) return [];
  if (now - (hook.receivedAt || 0) > SUBAGENT_STALE_MS) return [];
  return roster
    .filter((s) => s && typeof s.id === 'string' && RUNNING_SUBAGENT_STATES.has(s.state))
    .map((s) => ({
      id: s.id,
      state: s.state,
      agentType: s.agentType || '',
      description: (s.description || meta[s.id]?.description || '').replace(/\s+/g, ' ').trim(),
      startedAt: s.startedAt || 0
    }))
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

function titleIsBusy(terminal) {
  const glyph = [...(terminal.title || '')][0] || '';
  return !IDLE_GLYPHS.has(glyph) && BUSY_GLYPH.test(glyph);
}

// Orca reports "working" while any subagent runs, and subagent tool calls land on the parent's entry,
// so with subagents only the main agent's own mid-turn events (or a busy title) mean it is working itself.
function leadIsBusy(terminal, hook) {
  if (hook?.payload?.state === 'working' && !hook.toolAgentId && LEAD_BUSY_EVENTS.has(hook.hookEventName)) return true;
  return titleIsBusy(terminal);
}

function deriveStatus(terminal, hook, now, subagentCount = 0) {
  const state = hook?.payload?.state;
  if (state === 'blocked' || state === 'waiting' || state === 'permission') return 'waiting';
  if (subagentCount > 0) return leadIsBusy(terminal, hook) ? 'working' : 'subagents';
  if (state === 'working') return 'working';
  if (state === 'done') {
    if (hook.hookEventName === 'SessionStart') return 'idle';
    return now - (hook.stateStartedAt || hook.receivedAt || 0) < DONE_FADE_MS ? 'done' : 'idle';
  }
  return titleIsBusy(terminal) ? 'working' : 'idle';
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

function buildAgents(terminals, hookEntries, now = Date.now(), subagentMeta = {}) {
  const agents = [];
  for (const terminal of terminals) {
    if (!terminal.agentIdentity || terminal.orphaned || terminal.connected === false) continue;
    const hook = hookEntries[`${terminal.tabId}:${terminal.leafId}`];
    const subagents = activeSubagents(hook, now, subagentMeta);
    const status = deriveStatus(terminal, hook, now, subagents.length);
    const since = (status === 'subagents' && subagents[0].startedAt)
      || hook?.stateStartedAt || hook?.receivedAt || terminal.lastOutputAt || now;
    agents.push({
      handle: terminal.handle,
      agent: terminal.agentIdentity,
      worktreePath: terminal.worktreePath,
      transcriptPath: hook?.providerSession?.transcriptPath || null,
      project: projectLabel(terminal.worktreePath),
      workspace: workspaceLabel(terminal.worktreePath),
      task: taskLabel(terminal, hook),
      status,
      subagents,
      since,
      lastActivity: Math.max(hook?.receivedAt || 0, terminal.lastOutputAt || 0)
    });
  }

  // Needs-you first, then busy agents (oldest first, so keys stay put), then recently finished.
  agents.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus) return byStatus;
    if (STATUS_ORDER[a.status] <= STATUS_ORDER.working) return a.since - b.since || a.handle.localeCompare(b.handle);
    return b.lastActivity - a.lastActivity || a.handle.localeCompare(b.handle);
  });
  return agents;
}

// Slot order for agent keys: each main agent followed by its running subagents (oldest first).
// Subagent slots carry their live transcript (pressing one opens a viewer for it) and the parent's
// handle as a fallback.
function flattenSlots(agents) {
  const slots = [];
  for (const agent of agents) {
    slots.push({ kind: 'agent', ...agent });
    agent.subagents.forEach((sub, i) => {
      slots.push({
        kind: 'subagent',
        handle: agent.handle,
        parentProject: agent.project,
        index: i + 1,
        total: agent.subagents.length,
        id: sub.id,
        agentType: sub.agentType,
        description: sub.description,
        transcript: subagentTranscriptPath(agent.transcriptPath, sub.id),
        worktreePath: agent.worktreePath,
        status: sub.state === 'working' ? 'working' : 'waiting',
        since: sub.startedAt || agent.since
      });
    });
  }
  return slots;
}

async function loadAgents() {
  const [terminals, hooks] = await Promise.all([listTerminals(), readHookStatus()]);
  return buildAgents(terminals, hooks, Date.now(), await readSubagentMeta(hooks));
}

function bringOrcaToFront() {
  return new Promise((resolve) => execFile('/usr/bin/open', ['-a', 'Orca'], () => resolve()));
}

async function focusAgent(handle) {
  await runOrca(['terminal', 'switch', '--terminal', handle, '--json']);
  await bringOrcaToFront();
}

const VIEWER = path.join(__dirname, 'subagent-view.js');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function viewerTitle(slot) {
  return `↳ ${slot.agentType || 'subagent'} ${String(slot.id).slice(-6)}`;
}

// Subagents have no terminal of their own (they run inside the parent's session), so pressing a
// subagent key opens a terminal tab that follows its transcript live — reusing it if still open.
async function openSubagentView(slot) {
  if (!slot.transcript || !slot.worktreePath) throw new Error('no transcript for this subagent');
  const title = viewerTitle(slot);
  const existing = (await listTerminals()).find((t) => t.title === title && t.connected !== false && !t.orphaned);
  if (existing) return focusAgent(existing.handle);
  const command = [process.execPath, VIEWER, slot.transcript, title].map(shellQuote).join(' ');
  await runOrca(['terminal', 'create', '--worktree', `path:${slot.worktreePath}`, '--title', title, '--command', command, '--focus', '--json'], 10000);
  await bringOrcaToFront();
}

module.exports = {
  loadAgents, buildAgents, flattenSlots, deriveStatus, activeSubagents, subagentMetaPath, subagentTranscriptPath, projectLabel, taskLabel,
  focusAgent, openSubagentView, viewerTitle, shellQuote,
  DONE_FADE_MS, SUBAGENT_STALE_MS
};
