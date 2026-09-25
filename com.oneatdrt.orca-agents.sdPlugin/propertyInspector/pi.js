'use strict';

// Stream Dock calls this (Elgato-compatible SDK) when the panel opens.
let socket = null;
let uuid = null;

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

window.connectElgatoStreamDeckSocket = (port, inUUID, registerEvent, info, actionInfo) => {
  uuid = inUUID;
  const context = JSON.parse(actionInfo || '{}').context;
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen = () => {
    send({ event: registerEvent, uuid });
    send({ event: 'getGlobalSettings', context: uuid });
  };
  socket.onmessage = (msg) => {
    const { event, payload } = JSON.parse(msg.data);
    if (event === 'didReceiveGlobalSettings' && payload?.settings?.mainText) {
      document.getElementById('mainText').value = payload.settings.mainText;
    }
  };
  document.getElementById('mainText').addEventListener('change', (e) => {
    const mainText = e.target.value;
    send({ event: 'setGlobalSettings', context: uuid, payload: { mainText } });
    send({ event: 'sendToPlugin', action: 'com.oneatdrt.orca-agents.slot', context, payload: { mainText } });
  });
};
