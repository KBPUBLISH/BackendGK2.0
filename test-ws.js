const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:5001/api/tts/ws');

ws.on('open', () => {
    console.log('✅ Connected to backend WebSocket');
    ws.send(JSON.stringify({
        text: 'Hello world',
        voiceId: '21m00Tcm4TlvDq8ikWAM'
    }));
});

ws.on('message', (data) => {
    const message = JSON.parse(data);
    console.log('📨 Received:', message.type);
    if (message.type === 'complete' || message.error) {
        ws.close();
    }
});

ws.on('close', (code, reason) => {
    console.log(`🔌 Disconnected: ${code} ${reason}`);
});

ws.on('error', (error) => {
    console.error('❌ Error:', error.message);
});
