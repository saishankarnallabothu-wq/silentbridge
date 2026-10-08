// server.js - Real-Time Cross-Device Relay Server (Phone <-> Laptop)
// Optimized for 100% Offline Hotspot / LAN Emergency Operation
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
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
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      res.end(content);
    }
  });
});

// WebSocket Relay for Real-Time Cross-Device Synchronization
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    // Broadcast incoming SOS/ACK packets to all other connected devices on local network
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });
});

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ name, address: net.address });
      }
    }
  }
  return addresses;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log(`\n======================================================`);
  console.log(`🚀 SilentBridge Offline Mesh Server running!`);
  console.log(`💻 On Local Machine (HQ): http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log(`📱 On Other Devices (Hotspot / Offline Wi-Fi LAN):`);
    ips.forEach(ip => {
      console.log(`   ➔ http://${ip.address}:${PORT} (${ip.name})`);
    });
  } else {
    console.log(`📱 On Phone: Open http://<YOUR-LAPTOP-IP>:${PORT}`);
  }
  console.log(`======================================================\n`);
});