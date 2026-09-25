'use strict';

const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { loadAgents, flattenSlots, focusAgent, openSubagentView } = require('./agents');
const { mainTextFor, renderLimits, LIMIT_PAGES, leftColor, renderAgent, renderSubagent, renderEmpty, renderError, renderSummary } = require('./render');

const SLOT_ACTION = 'com.oneatdrt.orca-agents.slot';
const SUMMARY_ACTION = 'com.oneatdrt.orca-agents.summary';
const LIMITS_ACTION = 'com.oneatdrt.orca-agents.limits';
// Orca refreshes the limits itself; reading its copy once a minute is plenty.
const LIMITS_REFRESH_MS = 60000;
const RING_DELAY_MS = 800;
const RING_REASSERT_MS = 60000;
const REFRESH_MS = 2000;
const LOG_FILE = path.join(__dirname, 'log', 'plugin.log');
const { loadLimits, worstLeft } = require('./limits');
const { setKnobColor, releaseKnob } = require('./knob-led');

const startup = parseStartupArgs(process.argv);
const ws = new WebSocket(`ws://127.0.0.1:${startup.port}`);

// context -> { action, slotIndex, lastImage }
const keys = new Map();
// Slots handed out during this run, including keys on pages that are currently hidden.
const claimedSlots = new Map();
let agents = [];
// Slot keys show main agents, each followed by its running subagents.
let slots = [];
let lastError = null;
let blink = false;
let refreshing = false;
// AI Limits: last model from Orca ({ claude, gpt }), or null before the first read.
let limits = null;
let limitsTimer = null;
// Global setting (Property Inspector): big text on agent keys = 'auto' | 'task' | 'project'.
const MAIN_TEXT_MODES = new Set(['auto', 'task', 'project']);
let mainText = 'auto';

function applyGlobalSettings(settings = {}) {
  if (!MAIN_TEXT_MODES.has(settings.mainText) || settings.mainText === mainText) return;
  mainText = settings.mainText;
  log(`main text: ${mainText}`);
  for (const context of keys.keys()) paint(context);
}

ws.on('open', () => {
  log('connected');
  send({ uuid: startup.pluginUuid, event: startup.registerEvent });
  send({ event: 'getGlobalSettings', context: startup.pluginUuid });
  refresh();
  refreshLimits();
  limitsTimer = setInterval(refreshLimits, LIMITS_REFRESH_MS);
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

  if (event === 'didReceiveGlobalSettings') {
    applyGlobalSettings(payload.settings);
    return;
  }
  // The Property Inspector also sends the change directly, in case global-settings events lag.
  if (event === 'sendToPlugin' && payload.mainText) {
    applyGlobalSettings({ mainText: payload.mainText });
    return;
  }

  if (event === 'willAppear') {
    const square = payload.controller === 'Keypad';
    const key = { action, slotIndex: null, lastImage: null, square, knobIndex: square ? -1 : Number(payload.coordinates?.column ?? -1), lastRing: null, ringAt: 0, page: 0 };
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
    const key = keys.get(context);
    keys.delete(context);
    if (key?.action === LIMITS_ACTION && key.knobIndex >= 0) setTimeout(() => ring(() => releaseKnob(key.knobIndex)), RING_DELAY_MS);
    return;
  }

  // AI Limits: press (or knob turn) cycles overview -> Claude -> ChatGPT -> overview.
  const limitsKey = keys.get(context)?.action === LIMITS_ACTION ? keys.get(context) : null;
  if (limitsKey && (event === 'keyUp' || event === 'dialDown' || event === 'dialRotate')) {
    const step = event === 'dialRotate' ? Math.sign(Number(payload.ticks) || 0) : 1;
    if (!step) return;
    limitsKey.page = (limitsKey.page + step + LIMIT_PAGES.length) % LIMIT_PAGES.length;
    paint(context);
    if (event !== 'dialRotate') refreshLimits();
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
      || agents.find((a) => a.status === 'working' || a.status === 'subagents');
  } else {
    target = slots[key.slotIndex];
  }
  if (!target) {
    send({ event: 'showAlert', context });
    return;
  }
  if (target.kind === 'subagent') {
    try {
      await openSubagentView(target);
      log(`opened subagent view ${target.id} (${target.parentProject})`);
      return;
    } catch (err) {
      log(`subagent view failed, opening parent: ${err.message}`);
    }
  }
  await focusAgent(target.handle);
  log(`focused ${target.handle} (${target.project || target.parentProject})`);
}

async function refreshLimits() {
  try {
    limits = await loadLimits();
  } catch (err) {
    log(`limits refresh failed: ${err.message}`);
  }
  for (const [context, key] of keys) if (key.action === LIMITS_ACTION) paint(context);
  setTimeout(paintLimitRings, RING_DELAY_MS);
}

// Knob ring = colour of the provider with the least left (green / amber / red).
function paintLimitRings() {
  const worst = limits ? worstLeft(limits) : null;
  const now = Date.now();
  for (const key of keys.values()) {
    if (key.action !== LIMITS_ACTION || key.knobIndex < 0) continue;
    const rgb = worst == null ? null : hexToRgb(leftColor(worst));
    const tag = rgb ? rgb.join(',') : 'released';
    if (tag === key.lastRing && now - key.ringAt < RING_REASSERT_MS) continue;
    if (ring(() => (rgb ? setKnobColor(key.knobIndex, rgb) : releaseKnob(key.knobIndex)))) {
      key.lastRing = tag;
      key.ringAt = now;
    }
  }
}

let ringErrorLogged = false;
function ring(fn) {
  try {
    fn();
    ringErrorLogged = false;
    return true;
  } catch (err) {
    if (!ringErrorLogged) log(`knob ring update failed: ${err.message}`);
    ringErrorLogged = true;
    return false;
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    agents = await loadAgents();
    slots = flattenSlots(agents);
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
  if (key.action === LIMITS_ACTION) image = renderLimits(limits, { square: key.square, page: key.page });
  else if (lastError) image = renderError(lastError);
  else if (key.action === SUMMARY_ACTION) image = renderSummary(agents, blink);
  else {
    const slot = slots[key.slotIndex];
    if (!slot) image = renderEmpty(key.slotIndex);
    else if (slot.kind === 'subagent') image = renderSubagent(slot, Date.now(), blink);
    else image = renderAgent(slot, Date.now(), blink, mainTextFor(slot, agents, mainText));
  }

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
