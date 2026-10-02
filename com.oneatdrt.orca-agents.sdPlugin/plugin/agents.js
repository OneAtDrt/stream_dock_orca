'use strict';

const { execFile } = require('node:child_process');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { liveClaudeState } = require('./claude-sessions');
const { codexSubagentMeta, isPlaceholder } = require('./codex-sessions');

const ORCA_BIN = process.env.ORCA_BIN || '/Applications/Orca.app/Contents/Resources/bin/orca';
const HOOK_STATUS_FILE = process.env.ORCA_HOOK_STATUS_FILE
  || path.join(os.homedir(), 'Library/Application Support/orca/agent-hooks/last-status.json');
// Orca's UI state: acknowledgedAgentsByPaneKey = when each pane was last viewed (Orca's bell/unread).
const ORCA_DATA_FILE = process.env.ORCA_DATA_FILE
  || path.join(os.homedir(), 'Library/Application Support/orca/profiles/local-default/orca-data.json');
// This plugin's own record, kept across restarts: when it saw each pane's title go idle, and when
// a key press opened the pane.
const STATE_FILE = process.env.ORCA_AGENTS_STATE_FILE || path.join(os.tmpdir(), 'oneatdrt-orca-agents.json');

// A title stop this close after the hook's "done" is the same finished turn.
const SAME_TURN_MS = 60 * 1000;

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
      // "default" is Codex's placeholder role: prefer the name found in its session file.
      agentType: (isPlaceholder(s.agentType) && meta[s.id]?.agentType) || s.agentType || '',
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

// Orca's hook entry can be stale: a session started before the hooks were installed (or one whose
// hook events stopped arriving) keeps its last entry forever, e.g. a "Stop" from yesterday. The
// terminal title is live, so a busy spinner there beats an old entry.
const WAITING_TRUST_MS = 10 * 60 * 1000;
const HOOK_STALE_MS = 30 * 60 * 1000;

const paneKey = (terminal) => `${terminal.tabId}:${terminal.leafId}`;

// When the agent last finished a turn: Orca's hook "done" time or, for sessions whose hook entries
// are stale, when this plugin saw the title go from busy to idle (stoppedAt). 0 = unknown.
function finishedAt(hook, stoppedAt = null) {
  const hookDone = hook?.payload?.state === 'done' && hook.hookEventName !== 'SessionStart'
    ? hook.stateStartedAt || hook.receivedAt || 0 : 0;
  if (!stoppedAt || stoppedAt - hookDone < SAME_TURN_MS) return hookDone || stoppedAt || 0;
  return stoppedAt;
}

// viewedAt: when the pane was last viewed (in Orca or by a key press). A finished turn stays "done"
// (unread, like Orca's bell) until then, with no timeout.
// live: Claude Code's own session status { status, statusAt }. It is "waiting" while a dialog (e.g. a
// permission prompt) is open, and changes as soon as you answer, while Orca's hook entry keeps
// "waiting" until the next hook event (for an approved long command: when it finishes).
function deriveStatus(terminal, hook, now, subagentCount = 0, stoppedAt = null, liveBusy = false, viewedAt = 0, live = null) {
  const state = hook?.payload?.state;
  // Busy spinner in the title, or Claude Code's own session file saying "busy".
  const busy = titleIsBusy(terminal) || liveBusy;
  const hookAge = now - (hook?.receivedAt || 0);
  if (live?.status === 'waiting') return 'waiting';
  const answered = Boolean(live?.status && live.statusAt > (hook?.receivedAt || 0));
  if ((state === 'blocked' || state === 'waiting' || state === 'permission') && !answered && !(busy && hookAge > WAITING_TRUST_MS)) return 'waiting';
  if (subagentCount > 0) return leadIsBusy(terminal, hook) ? 'working' : 'subagents';
  if (busy) return 'working';
  if (state === 'working' && hookAge < HOOK_STALE_MS) return 'working';
  const finished = finishedAt(hook, stoppedAt);
  return finished && finished > (viewedAt || 0) ? 'done' : 'idle';
}

// Title transitions per terminal handle, kept across refreshes: { busy, stoppedAt }.
const titleWatch = new Map();

// state: this plugin's persisted state ({ stops, views } by pane); stops seed terminals seen for the
// first time (e.g. after a restart) and new stops are written back.
function watchTitles(terminals, now = Date.now(), watch = titleWatch, state = null) {
  const seen = new Set();
  for (const t of terminals) {
    seen.add(t.handle);
    const busy = titleIsBusy(t);
    const prev = watch.get(t.handle);
    if (busy) watch.set(t.handle, { busy: true, stoppedAt: null });
    else if (prev?.busy) {
      watch.set(t.handle, { busy: false, stoppedAt: now });
      if (state) {
        state.stops[paneKey(t)] = now;
        state.dirty = true;
      }
    } else if (!prev) watch.set(t.handle, { busy: false, stoppedAt: state?.stops[paneKey(t)] || null });
  }
  for (const handle of watch.keys()) if (!seen.has(handle)) watch.delete(handle);
  return watch;
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

// live: handle -> { busy, transcriptPath, subagents } from Claude Code's session files (claude-sessions.js).
// views: pane -> when it was last viewed (viewTimes).
function buildAgents(terminals, hookEntries, now = Date.now(), subagentMeta = {}, watch = new Map(), live = {}, views = {}) {
  const agents = [];
  for (const terminal of terminals) {
    if (!terminal.agentIdentity || terminal.orphaned || terminal.connected === false) continue;
    const pane = paneKey(terminal);
    const hook = hookEntries[pane];
    const liveState = live[terminal.handle];
    // Orca's roster first; when its entry is stale/empty, the subagents Claude Code is writing now.
    const rostered = activeSubagents(hook, now, subagentMeta);
    const subagents = rostered.length ? rostered : liveState?.subagents || [];
    const stoppedAt = watch.get(terminal.handle)?.stoppedAt || null;
    const status = deriveStatus(terminal, hook, now, subagents.length, stoppedAt, Boolean(liveState?.busy), views[pane], liveState);
    const since = (status === 'subagents' && subagents[0].startedAt)
      || (status === 'done' && finishedAt(hook, stoppedAt))
      || hook?.stateStartedAt || hook?.receivedAt || terminal.lastOutputAt || now;
    agents.push({
      handle: terminal.handle,
      pane,
      agent: terminal.agentIdentity,
      worktreePath: terminal.worktreePath,
      transcriptPath: liveState?.transcriptPath || hook?.providerSession?.transcriptPath || null,
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

// Orca's last-viewed time per pane. The file is large, so it is re-read only when it changes; a
// read mid-write keeps the previous values.
let orcaViews = { mtimeMs: 0, acks: {} };

async function readOrcaViews(file = ORCA_DATA_FILE) {
  try {
    const { mtimeMs } = await fs.stat(file);
    if (mtimeMs !== orcaViews.mtimeMs) {
      const ui = JSON.parse(await fs.readFile(file, 'utf8')).ui || {};
      orcaViews = { mtimeMs, acks: { ...ui.acknowledgedAgentsByPaneKey } };
    }
  } catch {
    // Missing or being rewritten: keep what we had.
  }
  return orcaViews.acks;
}

// Latest view per pane from Orca and from this plugin's key presses.
function viewTimes(orcaAcks = {}, pressed = {}) {
  const views = { ...orcaAcks };
  for (const [pane, at] of Object.entries(pressed)) views[pane] = Math.max(views[pane] || 0, at);
  return views;
}

let saved = null;

function loadSaved(file = STATE_FILE) {
  if (saved) return saved;
  try {
    const json = JSON.parse(fsSync.readFileSync(file, 'utf8'));
    saved = { stops: json.stops || {}, views: json.views || {} };
  } catch {
    saved = { stops: {}, views: {} };
  }
  return saved;
}

function writeSaved(file = STATE_FILE) {
  if (!saved) return;
  saved.dirty = false;
  try {
    fsSync.writeFileSync(file, JSON.stringify({ stops: saved.stops, views: saved.views }));
  } catch {
    // Not fatal: only restarts lose the record.
  }
}

// Forget panes that are gone.
function pruneSaved(state, terminals) {
  if (!terminals.length) return;
  const panes = new Set(terminals.map(paneKey));
  for (const map of [state.stops, state.views]) {
    for (const pane of Object.keys(map)) {
      if (panes.has(pane)) continue;
      delete map[pane];
      state.dirty = true;
    }
  }
}

// A key press that opened the pane counts as viewing it (Orca records a view only when it had
// something unread by its own hooks, so sessions with stale hooks would otherwise stay DONE).
function markViewed(pane, now = Date.now()) {
  if (!pane) return;
  loadSaved().views[pane] = now;
  writeSaved();
}

async function loadAgents() {
  const [terminals, hooks, acks] = await Promise.all([listTerminals(), readHookStatus(), readOrcaViews()]);
  const now = Date.now();
  const live = await liveClaudeState(terminals.filter((t) => !t.orphaned && t.connected !== false), (t) => taskLabel(t), now).catch(() => ({}));
  const meta = { ...(await readSubagentMeta(hooks)), ...(await codexSubagentMeta(hooks).catch(() => ({}))) };
  const state = loadSaved();
  pruneSaved(state, terminals);
  const watch = watchTitles(terminals, now, titleWatch, state);
  if (state.dirty) writeSaved();
  return buildAgents(terminals, hooks, now, meta, watch, live, viewTimes(acks, state.views));
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
  loadAgents, buildAgents, flattenSlots, deriveStatus, finishedAt, watchTitles, viewTimes, readOrcaViews, markViewed, activeSubagents, subagentMetaPath,
  subagentTranscriptPath, projectLabel, taskLabel, focusAgent, openSubagentView, viewerTitle, shellQuote,
  SUBAGENT_STALE_MS
};
