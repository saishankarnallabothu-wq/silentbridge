// server.js - Real-Time Cross-Device Relay Server (Phone <-> Laptop)
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const server = http.createServer((req, res) => {
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
  ws.on('message', (message) => {
    // Broadcast incoming SOS/ACK packets to all other connected devices
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 SilentBridge Mesh Server running!`);
  console.log(`💻 On Laptop (HQ): http://localhost:${PORT}`);
  console.log(`📱 On Phone: Open http://<YOUR-LAPTOP-IP>:${PORT}`);
  console.log(`======================================================\n`);
});