// server.js - Real-Time Cross-Device Relay Server (Phone <-> Laptop)
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Persistent Passcode Storage (Synchronized across all phones and laptops)
const PASSCODE_FILE = path.join(__dirname, 'passcode.json');
const DEFAULT_PASSCODE = 'RESCUE2026';

function readPasscode() {
  try {
    if (fs.existsSync(PASSCODE_FILE)) {
      const data = JSON.parse(fs.readFileSync(PASSCODE_FILE, 'utf8'));
      if (data && data.passcode) return String(data.passcode);
    }
  } catch (e) {
    console.warn("Passcode read error:", e.message);
  }
  return DEFAULT_PASSCODE;
}

function writePasscode(newPass) {
  try {
    if (!newPass) return false;
    fs.writeFileSync(PASSCODE_FILE, JSON.stringify({ passcode: String(newPass), updatedAt: Date.now() }, null, 2), 'utf8');
    console.log(`🔐 Passcode updated and synchronized: "${newPass}"`);
    return true;
  } catch (e) {
    console.warn("Passcode write error:", e.message);
    return false;
  }
}

const server = http.createServer((req, res) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // Cross-Device Passcode REST API
  if (req.url.startsWith('/api/passcode')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ passcode: readPasscode() }));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const newPass = parsed.passcode && String(parsed.passcode).trim();
          if (newPass && newPass.length >= 4) {
            writePasscode(newPass);

            // Broadcast passcode synchronization to all connected WebSockets immediately
            const syncPayload = JSON.stringify({ type: 'PASSCODE_SYNC', passcode: newPass, isPasscodeSync: true });
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(syncPayload);
              }
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, passcode: newPass }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Passcode must be at least 4 characters' }));
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
      });
      return;
    }
  }

  // Static File Serving
  let reqUrl = req.url === '/' ? 'index.html' : req.url.split('?')[0];
  let filePath = path.join(__dirname, reqUrl);
  const ext = path.extname(filePath);

  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
    } else {
      res.writeHead(200, { 
        'Content-Type': contentTypes[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
    }
  });
});

// WebSocket Relay for Real-Time Cross-Device Synchronization
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  // Instantly send current synchronized passcode to newly connected client
  try {
    const currentPass = readPasscode();
    ws.send(JSON.stringify({ type: 'PASSCODE_SYNC', passcode: currentPass, isPasscodeSync: true }));
  } catch (e) {}

  ws.on('message', (message) => {
    const msgStr = message.toString();
    try {
      const data = JSON.parse(msgStr);
      // Handle Passcode Sync broadcast over WebSocket
      if (data && (data.type === 'PASSCODE_SYNC' || data.isPasscodeSync) && data.passcode) {
        writePasscode(data.passcode);
      }
    } catch (e) {}

    // Broadcast incoming SOS/ACK/Passcode packets to all other connected devices
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(msgStr);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 SilentBridge Mesh Server running!`);
  console.log(`💻 On Laptop (HQ): http://localhost:${PORT}`);
  console.log(`📱 On Phone: Open http://<YOUR-LAPTOP-IP>:${PORT}`);
  console.log(`🔐 Current Passcode: "${readPasscode()}"`);
  console.log(`======================================================\n`);
});