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

The frontend can be deployed to Vercel as a static site from the repository root. No build command or output directory is required. `server.js` should continue to run locally or on a separate Node.js host because Vercel does not provide a persistent WebSocket server for this relay.

On Vercel, acoustic communication and same-browser `BroadcastChannel` synchronization continue to work. To restore cross-device WebSocket synchronization, define `window.SILENTBRIDGE_WS_URL` before `app.js` loads with the secure WebSocket URL of an external relay, for example `wss://relay.example.com`.
