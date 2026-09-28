'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseRollout, findRollout, dayDirs, isPlaceholder } = require('./codex-sessions');

const META = JSON.stringify({ type: 'session_meta', payload: {
  id: '01aa-child', parent_thread_id: '01aa-parent', agent_nickname: 'Gauss', agent_path: '/root/standards',
  source: { subagent: { thread_spawn: { parent_thread_id: '01aa-parent', agent_nickname: 'Gauss', agent_path: '/root/standards', agent_role: null } } }
} });

test('reads a Codex subagent name, task and model from its session file', () => {
  const tail = '{"type":"turn_context","payload":{"model":"default"}}\n{"type":"turn_context","payload":{"model":"gpt-x"}}\n';
  assert.deepEqual(parseRollout(META, tail), { name: 'Gauss', task: 'standards', model: 'gpt-x' });
  assert.deepEqual(parseRollout('not json', ''), { name: '', task: '', model: '' });
  assert.equal(isPlaceholder('default'), true);
  assert.equal(isPlaceholder(' Default '), true);
  assert.equal(isPlaceholder('reviewer'), false);
});

test('finds the session file by thread id in recent day folders', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sessions-test-'));
  const now = Date.parse('2026-01-15T12:00:00Z');
  const [today, yesterday] = dayDirs(root, now);
  fs.mkdirSync(yesterday, { recursive: true });
  fs.writeFileSync(path.join(yesterday, 'rollout-2026-01-14T10-00-00-01aa-child-123.jsonl'), META + '\n');
  assert.ok(today.endsWith(path.join('2026', '01', '15')));
  assert.match(await findRollout('01aa-child-123', root, now), /01aa-child-123\.jsonl$/);
  assert.equal(await findRollout('missing-id-000', root, now), null);
  assert.equal(await findRollout('../../etc', root, now), null);
  fs.rmSync(root, { recursive: true, force: true });
});
