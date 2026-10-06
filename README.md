# 🌉 SilentBridge

> **Off-Grid Acoustic & Cloud Mesh Emergency Rescue Network**  
> An emergency communication system designed to transmit critical SOS beacons, exact GPS telemetry, situational voice recordings, and responder acknowledgments across devices—operating over physical audio frequencies (near-ultrasound FSK), decentralized Cloud Mesh relays (WSS), and optional local WebSocket/BroadcastChannel meshes when cellular infrastructure fails.

---

## 🚀 Key Features

* **🎙️ Hands-Free Voice SOS Trigger:** Trapped or immobilized survivors can speak keywords like **"HELP"**, **"SOS"**, or **"EMERGENCY"** aloud to trigger immediate distress beacons hands-free (using Web Speech API with acoustic scream detection fallback).
* **🔊 Tactical Voice Announcements (TTS):** Automated speech synthesis vocalizes incoming distress alerts at Rescue HQ and speaks reassuring rescue confirmation when responders acknowledge beacons—working 100% offline.
* **🎙️ Embedded Survivor Voice Memos:** Records situational 5-second voice notes (WebM/Opus) and transmits them across cloud mesh and acoustic airwaves, with direct audio playback in the Rescuer Alert Banner, Leaflet Map popups, and Incident Feed cards.
* **🛡️ Two-Way Rescuer Voice Dispatch:** Responders can record tactical voice instructions (e.g. "Rescue team arriving in 3 minutes, stay calm") and attach them to the ACK packet, playing automatically on the survivor's phone.
* **🌐 Zero-Config Cross-Device Cloud Mesh:** Works out of the box on static hosts (e.g. Vercel, GitHub Pages) without needing a backend server, utilizing multi-broker Secure WebSockets (EMQX & HiveMQ failover) supporting voice audio packets up to 200KB.
* **🔊 Near-Ultrasound & Tactical Acoustic PHY:** Modulates data packets across audio frequencies with real-time spectrum visualization on phone and laptop speakers/microphones.
* **🛰️ High-Precision Satellite GPS with Fallback:** Captures exact physical coordinates with 64-bit double precision (`Float64`) and displays precision routing for disaster response units.
* **🚨 1-Tap Emergency Panic Dispatch:** Instant broadcast trigger that locks live satellite GPS coordinates and alerts nearby rescue hubs immediately with auto-retransmit until ACK is received.
* **🛡️ Secure Rescuer Command HQ:** Dedicated responder portal protected by passcode authentication (Default: `RESCUE2026`), featuring a dark-mode tactical map (Leaflet.js), incident feeds, turn-by-turn routing, and two-way ACK confirmations.
* **✅ Verified Rescue Confirmation (ACK):** Sends acknowledgement packets back to survivors, visually confirming rescue deployment on the sender's device with green status, haptic feedback, and voice readouts.
* **📡 Room / Network Channel Pairing:** Pair devices instantly using room codes (e.g. `#GLOBAL` or `?room=TEAM-1`) with 1-click shareable pairing links and test ping diagnostics.

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, Modern CSS / Tailwind CSS, JavaScript (Vanilla ES6+)
* **Mesh Network Bridge:** Multi-Transport WSS MQTT (EMQX / HiveMQ), Local WebSocket, BroadcastChannel API
* **Mapping Engine:** Leaflet.js, OpenStreetMap
* **Audio Layer:** Web Audio API (`AudioContext`, `OscillatorNode`, `AnalyserNode`)
* **Transport Protocol:** Custom 40-byte Binary Packet Engine + CRC-16 Checksum

---

## 📁 Project Structure

```text
silentbridge/
├── index.html        # Main tactical dashboard UI & Pairing Modal
├── app.js            # Main application logic, GPS resolver, and UI controls
├── meshBridge.js     # Multi-transport cross-device mesh relay engine
├── paho-mqtt.js      # Eclipse Paho MQTT client over Secure WebSockets (WSS)
├── audioModem.js     # Web Audio API acoustic transmitter and spectrum visualizer
├── packetEngine.js   # 64-bit float binary packet serializer and decoder
├── crc16.js          # CCITT CRC-16 error checking engine
├── server.js         # Optional local/hosted Node.js WebSocket bridge server
├── package.json      # Node.js dependencies and scripts
├── sw.js             # PWA Service Worker offline cache
└── vercel.json       # Static Vercel deployment configuration
```

---

## 📱 Cross-Device Usage (Phone & Laptop)

### Deployed on Vercel / Cloud
1. Open the deployed URL on **Device 1** (e.g., Phone): Select **🚨 SENDER (VICTIM)**.
2. Open the deployed URL on **Device 2** (e.g., Laptop): Select **🛡️ RESCUER (HQ)**.
   * Rescuer Default Passcode: `RESCUE2026` (or set a custom passcode).
3. Both devices automatically connect to the `#GLOBAL` room mesh channel over Secure WebSockets (`wss://`).
   * To use a private team channel, tap the **MESH: ONLINE** badge in the header, enter your room code (e.g., `ALPHA-1`), and click **Apply** or copy the pairing link.
4. On Phone (Sender):
   * **Hands-Free Trigger:** Tap **ACTIVATE HANDS-FREE VOICE SOS** and speak **"HELP"**, **"SOS"**, or **"EMERGENCY"** aloud to trigger the beacon hands-free.
   * **1-Tap Instant Panic:** Tap **🚨 TRANSMIT IMMEDIATE EMERGENCY GPS**.
   * **Voice Memo:** Tap **🎙️ Hold/Tap to Record Voice** to attach a 5-second situational voice note.
5. On Laptop (Rescuer): The alert siren wails, the tactical voice vocalizes the incident details aloud, the emergency card appears with survivor's live GPS marker, and the survivor's voice memo can be played directly from the alert banner or incident card.
6. Click **SEND RESCUE ACK ➔** on the laptop (optionally recording a rescuer voice instruction): the phone immediately turns green with **✓ SOS ACKNOWLEDGED & CONFIRMED**, vocalizes the rescue confirmation, vibrates, and plays the rescuer's voice note!

### Local Testing (Offline LAN / Same Network)
You can optionally run the local Node.js server:
```bash
npm start
```
* On Laptop: `http://localhost:3000`
* On Phone: `http://<YOUR-LAPTOP-IP>:3000`
