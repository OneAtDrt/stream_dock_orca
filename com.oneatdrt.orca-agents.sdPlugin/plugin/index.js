'use strict';

const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { loadAgents, focusAgent } = require('./agents');
const { renderAgent, renderEmpty, renderError, renderSummary } = require('./render');

const SLOT_ACTION = 'com.oneatdrt.orca-agents.slot';
const SUMMARY_ACTION = 'com.oneatdrt.orca-agents.summary';
const REFRESH_MS = 2000;
const LOG_FILE = path.join(__dirname, 'log', 'plugin.log');

const startup = parseStartupArgs(process.argv);
const ws = new WebSocket(`ws://127.0.0.1:${startup.port}`);

// context -> { action, slotIndex, lastImage }
const keys = new Map();
// Slots handed out during this run, including keys on pages that are currently hidden.
const claimedSlots = new Map();
let agents = [];
let lastError = null;
let blink = false;
let refreshing = false;

ws.on('open', () => {
  log('connected');
  send({ uuid: startup.pluginUuid, event: startup.registerEvent });
  refresh();
  setInterval(refresh, REFRESH_MS);
});

ws.on('close', () => {
  log('socket closed, exiting');
  process.exit(0);
});

ws.on('message', (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const { event, action, context, payload = {} } = message;

  if (event === 'willAppear') {
    const key = { action, slotIndex: null, lastImage: null };
    if (action === SLOT_ACTION) {
      key.slotIndex = Number.isInteger(payload.settings?.slotIndex) ? payload.settings.slotIndex : nextFreeSlot();
      claimedSlots.set(context, key.slotIndex);
      if (payload.settings?.slotIndex !== key.slotIndex) {
        send({ event: 'setSettings', context, payload: { slotIndex: key.slotIndex } });
      }
    }
    keys.set(context, key);
    paint(context);
    return;
  }

  if (event === 'willDisappear') {
    keys.delete(context);
    return;
  }

  if (event === 'keyUp') {
    onPress(context).catch((err) => log(`press failed: ${err.message}`));
  }
});

async function onPress(context) {
  const key = keys.get(context);
  if (!key) return;
  let target;
  if (key.action === SUMMARY_ACTION) {
    target = agents.find((a) => a.status === 'waiting')
      || agents.find((a) => a.status === 'done')
      || agents.find((a) => a.status === 'working');
  } else {
    target = agents[key.slotIndex];
  }
  if (!target) {
    send({ event: 'showAlert', context });
    return;
  }
  await focusAgent(target.handle);
  log(`focused ${target.handle} (${target.project})`);
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    agents = await loadAgents();
    lastError = null;
  } catch (err) {
    const message = /ENOENT/.test(err.message) ? 'Orca CLI not found' : 'Orca not running';
    if (lastError !== message) log(`refresh failed: ${err.message}`);
    lastError = message;
  } finally {
    refreshing = false;
  }
  blink = !blink;
  for (const context of keys.keys()) paint(context);
}

function paint(context) {
  const key = keys.get(context);
  if (!key) return;
  let image;
  if (lastError) image = renderError(lastError);
  else if (key.action === SUMMARY_ACTION) image = renderSummary(agents, blink);
  else image = agents[key.slotIndex] ? renderAgent(agents[key.slotIndex], Date.now(), blink) : renderEmpty(key.slotIndex);

  if (image === key.lastImage) return;
  key.lastImage = image;
  send({ event: 'setImage', context, payload: { target: 0, image } });
}

function nextFreeSlot() {
  const used = new Set(claimedSlots.values());
  let slot = 0;
  while (used.has(slot)) slot += 1;
  return slot;
}

function send(message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging must never break key handling.
  }
}

function parseStartupArgs(argv) {
  const flags = new Map();
  for (let i = 2; i < argv.length - 1; i += 1) {
    if (argv[i].startsWith('-')) flags.set(argv[i].replace(/^-+/, ''), argv[i + 1]);
  }
  return {
    port: flags.get('port'),
    pluginUuid: flags.get('pluginUUID'),
    registerEvent: flags.get('registerEvent')
  };
}
