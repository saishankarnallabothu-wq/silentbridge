# 🌉 SilentBridge

> **Off-Grid Acoustic & Cloud Mesh Emergency Rescue Network**  
> An emergency communication system designed to transmit critical SOS beacons, exact GPS telemetry, situational voice recordings, and responder acknowledgments across devices—operating 100% offline over physical audio airwaves (near-ultrasound & audible 4-FSK), autonomous multi-hop mesh relays, offline local phone hotspots/LANs, and decentralized Cloud Mesh relays (WSS).

---

## 🚀 Key Features

* **⚡ 100% Offline Standalone Operation:** Operates without any internet, cellular towers, or external servers. PWA Service Worker (`sw.js`) pre-caches all code, assets, audio modems, and local Leaflet tactical maps for instant off-grid loading anywhere.
* **📡 Infinite Distance via Autonomous Multi-Hop Mesh Relay:** Extends communication range across kilometers, neighborhoods, and disaster sectors by turning every active SilentBridge device into an autonomous mesh repeater node (up to 15 hops with TTL routing, gossip forwarder, and loop prevention).
* **🔊 Hardware DSP Acoustic Pre-Amp Booster (10x Sensitivity Boost):** Web Audio digital pre-amplifier (up to 8.5x gain), 900–2400Hz bandpass filtering, dynamic range compression, and dual-burst transmission enable reliable acoustic beacon detection across large rooms, hallways, and outdoor distances.
* **📶 Offline Local Hotspot / Wi-Fi Mesh Relay:** Devices connected to the same portable Wi-Fi router or mobile phone hotspot (even with mobile data completely off) sync instantly over local WebSocket relay (`ws://192.168.43.1:3000` / `ws://172.20.10.1:3000`).
* **📍 Unlimited Distance Rescuer Telemetry & Compass Bearing:** Rescuer Command HQ calculates exact geodesic distance (meters/km) and 16-point compass bearings (e.g. `📍 8.4 km (NE 42°)`), draws tactical vector trajectory lines on the map, and auto-scales viewports to encompass any distance without geographic restrictions.
* **💾 Offline Disaster Vault (Store-and-Forward):** Unacknowledged SOS beacons and incident records are persisted in local storage (`localStorage`). When any peer or network connection is discovered, queued beacons are automatically flushed and delivered.
* **🎙️ Hands-Free Voice SOS Trigger:** Trapped or immobilized survivors can speak keywords like **"HELP"**, **"SOS"**, or **"EMERGENCY"** aloud to trigger immediate distress beacons hands-free.
* **🔊 Tactical Voice Announcements (TTS):** Automated speech synthesis vocalizes incoming distress alerts at Rescue HQ and speaks reassuring rescue confirmations when responders acknowledge beacons—working 100% offline.
* **🎙️ Embedded Survivor Voice Memos:** Records situational 5-second voice notes (WebM/Opus) and transmits them across cloud mesh and acoustic airwaves, with direct audio playback in the Rescuer Alert Banner, Leaflet Map popups, and Incident Feed cards.
* **🛡️ Two-Way Rescuer Voice Dispatch:** Responders can record tactical voice instructions (e.g. "Rescue team arriving in 3 minutes, stay calm") and attach them to the ACK packet, playing automatically on the survivor's phone.
* **🚨 1-Tap Emergency Panic Dispatch:** Instant broadcast trigger that locks satellite GPS coordinates and alerts nearby rescue hubs immediately with auto-retransmit until ACK is received.
* **🛡️ Secure Rescuer Command HQ:** Dedicated responder portal protected by passcode authentication (Default: `RESCUE2026`), featuring a dark-mode tactical map (Leaflet.js), incident feeds, turn-by-turn routing, and two-way ACK confirmations.
* **✅ Verified Rescue Confirmation (ACK):** Sends acknowledgement packets back to survivors, visually confirming rescue deployment on the sender's device with green status, haptic feedback, and voice readouts.

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, Modern CSS / Tailwind CSS Fallback, JavaScript (Vanilla ES6+)
* **Mesh Network Bridge:** Autonomous Multi-Hop Relay, Local Offline Hotspot/LAN WebSocket, BroadcastChannel API, Cloud WSS MQTT (EMQX / HiveMQ)
* **Acoustic Audio DSP:** Web Audio API (`AudioContext`, `BiquadFilterNode`, `DynamicsCompressorNode`, `GainNode`, `AnalyserNode`)
* **Mapping Engine:** Leaflet.js (100% Local Offline Bundled), OpenStreetMap
* **Transport Protocol:** Custom 40-byte Binary Packet Engine + CCITT CRC-16 Checksum
* **Storage:** PWA Service Worker Cache Storage & Disaster Vault (`localStorage`)

---

## 📁 Project Structure

```text
silentbridge/
├── index.html        # Tactical dashboard UI, Offline Hotspot & Mesh Range Modal
├── app.js            # Main application logic, GPS resolver, distance & UI controls
├── meshBridge.js     # Autonomous Multi-Hop Relay & Cross-Device Mesh Engine
├── audioModem.js     # DSP Pre-Amplifier, 4-FSK acoustic modem & spectrum visualizer
├── packetEngine.js   # 64-bit float binary serializer & Multi-Hop Hop/TTL engine
├── crc16.js          # CCITT CRC-16 error checking engine
├── leaflet.css       # 100% Local Offline Leaflet stylesheet
├── leaflet.js        # 100% Local Offline Leaflet mapping engine
├── images/           # Leaflet offline marker icons and tile overlays
├── server.js         # Offline Hotspot / LAN Node.js WebSocket bridge server
├── sw.js             # PWA Service Worker offline cache engine (v14)
├── manifest.json     # PWA standalone web app manifest
└── vercel.json       # Static Vercel deployment configuration
```

---

## 📱 Offline & Large-Distance Operation

### Scenario 1: 100% Off-Grid (No Internet, Direct Acoustic Airwaves)
1. Open SilentBridge on **Phone (Sender)** and **Laptop (Rescuer HQ)** (cached by Service Worker).
2. Rescuer unlocks Command HQ (Default: `RESCUE2026`). Microphone automatically monitors airwaves.
3. Acoustic Range is set to **⚡ Long Range** (5.5x Pre-Amp boost + matched filtering) by default.
4. When survivor triggers SOS / Panic, phone speaker transmits high-power 4-FSK acoustic bursts (1200–2200Hz).
5. Rescuer microphone detects and decodes the beacon, wailing the emergency siren, plotting GPS coordinates, and vocalizing telemetry.
6. Rescuer clicks **SEND RESCUE ACK**: phone confirms with green status, alarm chime, and voice readout!

### Scenario 2: Large Distances via Autonomous Multi-Hop Mesh Relay
1. When sender and rescuer are separated by large distances (hundreds of meters or kilometers), intermediate devices running SilentBridge automatically act as **Mesh Relay Repeaters**.
2. Beacons are assigned **TTL: 15 Hops**. Intermediate devices re-broadcast received packets across acoustic sound and local networks.
3. Rescuer receives the alert with full telemetry: `📍 Distance: 4.8 km (NE 42°) • 📡 Relayed (2 Hops)`.
4. The Leaflet map draws a tactical vector connecting Rescuer and Survivor, auto-fitting bounds to display the entire route.

### Scenario 3: Offline Mobile Hotspot / Wi-Fi LAN (0 Internet Needed)
1. Turn on a mobile hotspot on any phone (cellular data is NOT required).
2. Connect other phones or laptops to that hotspot Wi-Fi.
3. Start the local server on laptop:
   ```bash
   npm start
   ```
4. Open the displayed local IP URL (e.g. `http://192.168.43.15:3000`).
5. In the Mesh Modal (⚙️), tap **📱 Android Hotspot (192.168.43.1)** or your local IP: all devices synchronize over Wi-Fi with zero internet connection!
