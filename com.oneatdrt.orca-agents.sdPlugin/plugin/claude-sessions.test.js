'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSessions, projectDir, matchSession, liveSubagents, SUBAGENT_ACTIVE_MS } = require('./claude-sessions');
const { buildAgents } = require('./agents');

test('project folder name and session matching by folder + name', () => {
  assert.equal(projectDir('/w/my-api.v2', '/c'), '/c/projects/-w-my-api-v2');
  const sessions = [
    { sessionId: 'a', cwd: '/w/my-api', name: 'Migrate billing' },
    { sessionId: 'b', cwd: '/w/my-api', name: 'Fix login' },
    { sessionId: 'c', cwd: '/w/docs', name: 'Anything' }
  ];
  assert.equal(matchSession({ worktreePath: '/w/my-api' }, 'Fix login', sessions).sessionId, 'b');
  assert.equal(matchSession({ worktreePath: '/w/my-api' }, 'Unknown', sessions), null); // ambiguous
  assert.equal(matchSession({ worktreePath: '/w/docs' }, '', sessions).sessionId, 'c'); // only one there
});

test('reads live sessions and recently written subagent transcripts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sessions-test-'));
  const sessDir = path.join(root, 'sessions');
  fs.mkdirSync(sessDir);
  fs.writeFileSync(path.join(sessDir, '111.json'), JSON.stringify({ pid: 111, sessionId: 's1', cwd: '/w/my-api', name: 'Migrate', status: 'busy' }));
  fs.writeFileSync(path.join(sessDir, '222.json'), JSON.stringify({ pid: 222, sessionId: 's2', cwd: '/w/x', name: 'Dead' }));
  fs.writeFileSync(path.join(sessDir, '111.abc.key'), 'secret');
  const sessions = await readSessions(sessDir, (pid) => pid === 111);
  assert.deepEqual(sessions.map((s) => s.sessionId), ['s1']);

  const sub = path.join(projectDir('/w/my-api', root), 's1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-aimpl-1.jsonl'), '{}\n');
  fs.writeFileSync(path.join(sub, 'agent-aimpl-1.meta.json'), JSON.stringify({ agentType: 'impl', description: 'Implement  the thing' }));
  fs.writeFileSync(path.join(sub, 'agent-aold-2.jsonl'), '{}\n');
  const old = (Date.now() - SUBAGENT_ACTIVE_MS - 60e3) / 1000;
  fs.utimesSync(path.join(sub, 'agent-aold-2.jsonl'), old, old);
  const subs = await liveSubagents(sessions[0], Date.now(), root);
  assert.deepEqual(subs.map((s) => [s.id, s.agentType, s.description, s.state]), [['aimpl-1', 'impl', 'Implement the thing', 'working']]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('live Claude state fills in subagents and busy when Orca hooks are stale', () => {
  const NOW = 1_800_000_000_000;
  const term = { handle: 'h', tabId: 't', leafId: 'l', agentIdentity: 'claude', connected: true, worktreePath: '/w/my-api', title: '✳ Migrate', lastOutputAt: NOW };
  const stale = { 't:l': { hookEventName: 'Stop', payload: { state: 'done' }, receivedAt: NOW - 30 * 3600e3, stateStartedAt: NOW - 30 * 3600e3 } };
  const live = { h: { busy: true, transcriptPath: '/c/projects/-w-my-api/s1.jsonl', subagents: [{ id: 'a1', state: 'working', agentType: 'impl', description: 'Do it', startedAt: NOW - 60e3 }] } };
  const [agent] = buildAgents([term], stale, NOW, {}, new Map(), live);
  assert.equal(agent.subagents.length, 1);
  assert.equal(agent.transcriptPath, '/c/projects/-w-my-api/s1.jsonl');
  assert.notEqual(agent.status, 'idle');
  const [plain] = buildAgents([term], stale, NOW, {}, new Map(), { h: { busy: true, subagents: [] } });
  assert.equal(plain.status, 'working'); // busy session, no subagents
});

test('live state carries the session status and when it changed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fs.writeFileSync(path.join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: 's', cwd: '/w', status: 'waiting', statusUpdatedAt: 5 }));
  const [s] = await readSessions(dir, () => true);
  assert.equal(s.status, 'waiting');
  assert.equal(s.statusUpdatedAt, 5);
});
