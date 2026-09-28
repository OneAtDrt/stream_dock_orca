'use strict';

// Names for Codex subagents. Orca lists them with agentType/model "default" (Codex's role when a
// spawn names none), e.g. when a Claude agent runs `codex exec` and Codex's hook reports its
// subagents on the Claude pane. Each Codex subagent is its own session file in
// ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl whose first line (session_meta) has
// agent_nickname ("Gauss") and agent_path ("/root/standards"); later lines carry the model.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SESSIONS_DIR = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
const LOOKBACK_DAYS = 2;
const TAIL_BYTES = 64 * 1024;

const isPlaceholder = (v) => !v || String(v).trim().toLowerCase() === 'default';

// Day folders to search, newest first: today and the previous LOOKBACK_DAYS days.
function dayDirs(root, now = Date.now()) {
  return Array.from({ length: LOOKBACK_DAYS + 1 }, (_, i) => {
    const d = new Date(now - i * 86400e3);
    return path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  });
}

async function findRollout(id, root = SESSIONS_DIR, now = Date.now()) {
  if (!/^[\w-]{8,}$/.test(String(id))) return null;
  for (const dir of dayDirs(root, now)) {
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    const hit = names.find((n) => n.endsWith(`-${id}.jsonl`));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

// session_meta line + the last model seen -> { name, task, model } (any may be missing).
function parseRollout(firstLine, tail) {
  let meta = {};
  try {
    meta = JSON.parse(firstLine).payload || {};
  } catch {
    // Unreadable first line: fall through with what the tail has.
  }
  const spawn = meta.source?.subagent?.thread_spawn || {};
  const agentPath = meta.agent_path || spawn.agent_path || '';
  const models = [...String(tail).matchAll(/"model":"([^"\\]+)"/g)].map((m) => m[1]).filter((m) => !isPlaceholder(m));
  return {
    name: meta.agent_nickname || spawn.agent_nickname || '',
    task: agentPath.split('/').filter(Boolean).pop() || '',
    model: models.length ? models[models.length - 1] : ''
  };
}

async function readRollout(file) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(Math.min(size, 256 * 1024));
    await handle.read(head, 0, head.length, 0);
    const tail = Buffer.alloc(Math.min(size, TAIL_BYTES));
    await handle.read(tail, 0, tail.length, Math.max(0, size - tail.length));
    return parseRollout(head.toString('utf8').split('\n')[0], tail.toString('utf8'));
  } finally {
    await handle.close();
  }
}

// Found names never change; misses are retried on the next refresh (the file may not exist yet).
const cache = new Map();

async function codexSubagentInfo(id) {
  if (cache.has(id)) return cache.get(id);
  const file = await findRollout(id);
  if (!file) return null;
  const info = await readRollout(file).catch(() => null);
  if (info && (info.name || info.task)) cache.set(id, info);
  return info;
}

// Subagent roster entries with placeholder names -> meta { agentType, description } by id.
async function codexSubagentMeta(hookEntries) {
  const meta = {};
  for (const hook of Object.values(hookEntries)) {
    for (const s of hook?.payload?.subagents || []) {
      if (!s?.id || !isPlaceholder(s.agentType)) continue;
      const info = await codexSubagentInfo(s.id).catch(() => null);
      if (!info) continue;
      meta[s.id] = {
        agentType: info.task || info.name || 'codex',
        description: [info.name, info.model || (isPlaceholder(s.model) ? '' : s.model)].filter(Boolean).join(' · ')
      };
    }
  }
  return meta;
}

module.exports = { codexSubagentMeta, codexSubagentInfo, parseRollout, findRollout, dayDirs, isPlaceholder };
