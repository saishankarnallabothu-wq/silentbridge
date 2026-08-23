# 🌉 SilentBridge

> **Off-Grid Acoustic Emergency Mesh Network**  
> An emergency communication system designed to transmit critical SOS beacons, exact GPS telemetry, situational voice recordings, and responder acknowledgments—operating entirely over physical audio frequencies (near-ultrasound) and decentralized WebRTC/WebSocket fallback relays when cellular infrastructure fails.

---

## 🚀 Key Features

* **🔊 Near-Ultrasound Acoustic PHY:** Modulates data packets using FSK (Frequency-Shift Keying) across audio frequencies to communicate device-to-device through standard phone speakers and microphones without cellular or Wi-Fi data.
* **🛰️ High-Precision Satellite GPS:** Captures exact physical coordinates with 64-bit double precision (`Float64`) and displays precision routing for disaster response units.
* **🚨 1-Tap Emergency Panic Dispatch:** Instant broadcast trigger that locks live satellite GPS coordinates and alerts nearby rescue hubs immediately.
* **🎙️ Embedded Survivor Voice Memos:** Records and transmits situational voice notes alongside distress telemetry.
* **🛡️ Secure Rescuer Command HQ:** Dedicated responder portal protected by passcode authentication, featuring a dark-mode tactical map (Leaflet.js), incident feeds, turn-by-turn routing, and two-way ACK confirmations.
* **✅ Verified Rescue Confirmation (ACK):** Sends acoustic/mesh acknowledgement packets back to survivors, visually confirming rescue deployment on the sender's device.

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, Modern CSS / Tailwind CSS, JavaScript (Vanilla ES6+)
* **Mapping Engine:** Leaflet.js, OpenStreetMap
* **Audio Layer:** Web Audio API (`AudioContext`, `OscillatorNode`, `AnalyserNode`)
* **Transport Protocol:** Custom 40-byte Binary Packet Engine + CRC-16 Checksum
* **Network Synchronization:** WebSockets & BroadcastChannel API

---

## 📁 Project Structure

```text
silentbridge/
├── index.html        # Main tactical dashboard UI
├── app.js            # Main application logic, GPS resolver, and UI controls
├── audioModem.js     # Web Audio API acoustic transmitter and receiver
├── packetEngine.js   # 64-bit float binary packet serializer and decoder
├── crc16.js          # CRC-16 error checking engine
├── server.js         # Local Node.js WebSocket mesh bridge server
├── package.json      # Node.js dependencies and scripts
└── vercel.json       # Static Vercel deployment configuration
```

## Vercel Deployment

The frontend can be deployed to Vercel as a static site from the repository root. No build command or output directory is required. `server.js` must run on a separate WebSocket-capable Node.js host because Vercel does not provide a persistent WebSocket server for this relay.

To enable cross-device synchronization:

1. Create a Web Service on Render, Railway, or Fly.io using this repository.
2. Set its build command to `npm install` and start command to `npm start`.
3. Copy its public HTTPS hostname and use the `wss://` version as the relay URL.
4. Open the Vercel app with the relay query parameter, for example `https://your-app.vercel.app/?relay=wss%3A%2F%2Fyour-relay.onrender.com`.

The acoustic and same-browser `BroadcastChannel` features work without the relay. Do not use `https://` in the `relay` value; WebSockets require `wss://` for deployed HTTPS pages.
