// meshBridge.js - Multi-Transport Real-Time Cross-Device Relay for SilentBridge
// Supports: Autonomous Multi-Hop Relay, Cloud WSS MQTT, Offline Local Hotspot / LAN WS, and BroadcastChannel
// Enables communication across large distances and true off-grid disaster operation

class SilentBridgeMesh {
  constructor(options = {}) {
    this.deviceId = options.deviceId || 'sb_' + Math.random().toString(36).substring(2, 9);
    this.roomCode = (options.roomCode || this.getInitialRoomCode()).toUpperCase();
    this.role = options.role || 'sender';

    this.onPacket = options.onPacket || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.onPeersChange = options.onPeersChange || (() => {});
    this.onRelayForward = options.onRelayForward || (() => {});

    this.cloudConnected = false;
    this.wsConnected = false;
    this.enableRelay = true; // Autonomous Multi-Hop Relay Node enabled by default
    this.maxMeshHops = 15;   // Increased range limit up to 15 hops across large distances

    // Public Secure WebSocket MQTT Brokers (Works globally across HTTPS/Vercel with zero backend)
    this.activeBrokers = [
      { host: 'broker.hivemq.com', port: 8884, path: '/mqtt', name: 'HiveMQ Cloud Mesh' },
      { host: 'broker.emqx.io', port: 8084, path: '/mqtt', name: 'EMQX Cloud Mesh' }
    ];
    this.currentBrokerIndex = 0;

    this.mqttClient = null;
    this.wsClient = null;
    this.broadcastChannel = null;

    this.peers = new Map(); // deviceId -> { role, lastSeen }
    this.heartbeatTimer = null;
    this.seenPacketIds = new Set();
    this.relayedPackets = new Set();
    this.offlineQueue = this.loadOfflineQueue();

    this.customWsUrl = options.customWsUrl || this.getInitialWsUrl();

    this.initBroadcastChannel();
    this.initCloudMqtt();
    if (this.customWsUrl) {
      this.initCustomWs();
    }
    this.startHeartbeat();
  }

  loadOfflineQueue() {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('silentbridge_offline_tx_queue');
        if (stored) return JSON.parse(stored);
      }
    } catch (e) {}
    return [];
  }

  saveOfflineQueue() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('silentbridge_offline_tx_queue', JSON.stringify(this.offlineQueue.slice(-20)));
      }
    } catch (e) {}
  }

  flushOfflineQueue() {
    if (this.offlineQueue.length === 0) return;
    console.log(`📦 Flushing ${this.offlineQueue.length} queued offline packets to active mesh transport...`);
    const queueCopy = [...this.offlineQueue];
    this.offlineQueue = [];
    this.saveOfflineQueue();
    queueCopy.forEach(pkt => {
      this.sendPacket(pkt, false);
    });
  }

  getInitialRoomCode() {
    try {
      if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const fromUrl = urlParams.get('room') || urlParams.get('channel');
        if (fromUrl) return fromUrl.trim().toUpperCase();
      }
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('silentbridge_room');
        if (saved) return saved.trim().toUpperCase();
      }
    } catch (e) {
      console.warn("Room resolution note:", e);
    }
    return 'GLOBAL';
  }

  getInitialWsUrl() {
    try {
      if (typeof window !== 'undefined' && window.location) {
        const relayFromUrl = new URLSearchParams(window.location.search).get('relay');
        if (relayFromUrl) return relayFromUrl;
        if (window.SILENTBRIDGE_WS_URL) return window.SILENTBRIDGE_WS_URL;

        if (typeof localStorage !== 'undefined') {
          const savedWs = localStorage.getItem('silentbridge_custom_ws');
          if (savedWs) return savedWs;
        }

        const hostname = (window.location && window.location.hostname) || '';
        const isLocalRelayHost = hostname && (hostname === 'localhost'
          || hostname === '127.0.0.1'
          || hostname === '::1'
          || hostname.endsWith('.local')
          || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname));

        if (isLocalRelayHost) {
          const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const port = window.location.port ? `:${window.location.port}` : ':3000';
          return `${wsProtocol}//${hostname}${port}`;
        }
      }
    } catch (e) {
      console.warn("Relay URL resolution note:", e);
    }
    return null;
  }

  setRole(newRole) {
    this.role = newRole;
    if (this.mqttClient && this.cloudConnected) {
      const topics = ['silentbridge/v2/#', 'silentbridge/v2/GLOBAL', `silentbridge/v2/${this.roomCode}`];
      topics.forEach(t => {
        try { this.mqttClient.subscribe(t, { qos: 1 }); } catch (e) {}
      });
    }
    this.sendPing();
  }

  setRoom(newRoom) {
    if (!newRoom) return;
    const cleanRoom = newRoom.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!cleanRoom || cleanRoom === this.roomCode) return;

    console.log(`Switching mesh room from #${this.roomCode} to #${cleanRoom}`);
    const oldTopic = `silentbridge/v2/${this.roomCode}`;
    this.roomCode = cleanRoom;

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('silentbridge_room', cleanRoom);
      }
      if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', cleanRoom);
        window.history.replaceState({}, '', url.toString());
      }
    } catch (e) {
      console.warn("Room persist note:", e);
    }

    // Recreate BroadcastChannel
    this.initBroadcastChannel();

    // Resubscribe MQTT
    if (this.mqttClient && this.cloudConnected) {
      try {
        this.mqttClient.unsubscribe(oldTopic);
      } catch (e) {}

      const topics = (this.role === 'receiver')
        ? ['silentbridge/v2/#']
        : [`silentbridge/v2/${this.roomCode}`, 'silentbridge/v2/GLOBAL'];

      topics.forEach(t => {
        try {
          this.mqttClient.subscribe(t, {
            onSuccess: () => {
              console.log(`Subscribed to mesh topic: ${t}`);
              this.notifyStatus('connected', `Switched to room #${this.roomCode}`);
              this.sendPing();
            }
          });
        } catch (e) {}
      });
    }

    this.peers.clear();
    this.notifyPeers();
  }

  initBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') return;

    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch (e) {}
    }

    try {
      this.broadcastChannel = new BroadcastChannel(`silentbridge_mesh_${this.roomCode}`);
      this.broadcastChannel.onmessage = (event) => {
        if (event.data) {
          this.handleIncoming(event.data, 'broadcast_channel');
        }
      };
    } catch (e) {
      console.warn("BroadcastChannel initialization note:", e);
    }
  }

  initCloudMqtt() {
    if (typeof Paho === 'undefined' || !Paho.MQTT || !Paho.MQTT.Client) {
      console.warn("Paho MQTT library not yet loaded, will retry in 1s...");
      setTimeout(() => this.initCloudMqtt(), 1000);
      return;
    }

    const broker = this.activeBrokers[0];
    const clientId = `sb_${this.deviceId}_${Math.random().toString(36).substring(2, 6)}`;

    try {
      this.mqttClient = new Paho.MQTT.Client(broker.host, Number(broker.port), broker.path, clientId);

      this.mqttClient.onConnectionLost = (resp) => {
        this.cloudConnected = false;
        console.warn(`MQTT connection lost from ${broker.name}:`, resp.errorMessage);
        this.notifyStatus('reconnecting', `Relay reconnecting (${resp.errorMessage || 'lost'})...`);
        setTimeout(() => this.initCloudMqtt(), 2000);
      };

      this.mqttClient.onMessageArrived = (message) => {
        try {
          const payload = JSON.parse(message.payloadString);
          this.handleIncoming(payload, 'cloud_mesh');
        } catch (err) {
          console.warn("MQTT message parse note:", err);
        }
      };

      this.notifyStatus('connecting', `Connecting to ${broker.name}...`);

      this.mqttClient.connect({
        useSSL: true,
        timeout: 10,
        keepAliveInterval: 15,
        cleanSession: true,
        onSuccess: () => {
          this.cloudConnected = true;
          // Universal subscription for BOTH Senders and Receivers across all distances:
          const topics = [
            'silentbridge/v2/#',
            'silentbridge/v2/GLOBAL',
            `silentbridge/v2/${this.roomCode}`
          ];

          topics.forEach(t => {
            this.mqttClient.subscribe(t, {
              qos: 1,
              onSuccess: () => console.log(`✅ Subscribed to ${t}`),
              onFailure: (err) => console.warn(`Failed subscribe ${t}:`, err)
            });
          });

          console.log(`✅ Cloud Mesh active on ${broker.name} [Room: #${this.roomCode}]`);
          this.notifyStatus('connected', `Mesh Online: Connected to ${broker.name}`);
          this.sendPing();
          this.flushOfflineQueue();
        },
        onFailure: (err) => {
          this.cloudConnected = false;
          console.warn(`Failed to connect to ${broker.name}:`, err);
          this.notifyStatus('offline', 'Mesh Offline (Acoustic + Local Mesh Active)');
          setTimeout(() => this.initCloudMqtt(), 4000);
        }
      });
    } catch (err) {
      console.warn("MQTT init error:", err);
      setTimeout(() => this.initCloudMqtt(), 4000);
    }
  }

  setCustomWsUrl(url) {
    if (!url) return;
    this.customWsUrl = url.trim();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('silentbridge_custom_ws', this.customWsUrl);
      }
    } catch (e) {}
    this.initCustomWs(this.customWsUrl);
  }

  initCustomWs(customUrl) {
    if (customUrl) this.customWsUrl = customUrl;
    if (!this.customWsUrl) return;

    if (this.wsClient) {
      try { this.wsClient.close(); } catch (e) {}
      this.wsClient = null;
    }

    try {
      console.log("Connecting to offline/local WebSocket relay:", this.customWsUrl);
      this.wsClient = new WebSocket(this.customWsUrl);

      this.wsClient.onopen = () => {
        this.wsConnected = true;
        console.log("✅ Local Offline Hotspot/LAN WebSocket connected:", this.customWsUrl);
        this.notifyStatus('connected', `Local Mesh Connected: ${this.customWsUrl}`);
        this.sendPing();
        this.flushOfflineQueue();
      };

      this.wsClient.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data) this.handleIncoming(data, 'local_ws');
        } catch (e) {
          console.warn("Custom WS message parse error:", e);
        }
      };

      this.wsClient.onerror = (e) => {
        this.wsConnected = false;
        console.warn("Local WS notice:", e);
      };

      this.wsClient.onclose = () => {
        this.wsConnected = false;
        setTimeout(() => {
          if (this.customWsUrl) this.initCustomWs();
        }, 5000);
      };
    } catch (e) {
      console.warn("Local WS init error:", e);
    }
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Send ping every 8 seconds to maintain presence
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
      this.pruneOldPeers();
    }, 8000);
  }

  sendPing() {
    this.sendPacket({
      type: 0xFE,
      isHeartbeat: true,
      deviceId: this.deviceId,
      role: this.role,
      room: this.roomCode,
      timestamp: new Date().toLocaleTimeString()
    }, true);
  }

  sendTestPing() {
    const testId = Math.floor(1000 + Math.random() * 9000);
    const timeStr = new Date().toLocaleTimeString();
    this.sendPacket({
      msgId: testId,
      type: 0xFD,
      isTest: true,
      text: `PING CHECK FROM ${this.role.toUpperCase()}`,
      timestamp: timeStr,
      ttl: this.maxMeshHops,
      hops: 0
    });
    return testId;
  }

  sendPacket(packetObj, isInternal = false) {
    if (!packetObj) return;

    if (!packetObj._senderDevice) packetObj._senderDevice = this.deviceId;
    if (!packetObj._senderRole) packetObj._senderRole = this.role;
    if (!packetObj._room) packetObj._room = this.roomCode;
    packetObj._txTime = Date.now();
    if (packetObj.ttl === undefined) packetObj.ttl = this.maxMeshHops;
    if (packetObj.hops === undefined) packetObj.hops = 0;

    const payloadString = JSON.stringify(packetObj);

    // 1. Same-device / tab-to-tab BroadcastChannel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(packetObj);
      } catch (e) {}
    }

    // 2. Cloud Mesh MQTT (Worldwide cross-device relay)
    let dispatchedOverNetwork = false;
    if (this.mqttClient && this.cloudConnected) {
      try {
        const mqttPacket = { ...packetObj };
        if (mqttPacket.voiceAudio && mqttPacket.voiceAudio.length > 48000) {
          mqttPacket.hasVoice = true;
          mqttPacket.voiceAudio = null;
        }
        if (mqttPacket.ackVoiceAudio && mqttPacket.ackVoiceAudio.length > 48000) {
          mqttPacket.hasAckVoice = true;
          mqttPacket.ackVoiceAudio = null;
        }

        const mqttPayload = JSON.stringify(mqttPacket);
        const targetRoom = packetObj._room || this.roomCode || 'GLOBAL';

        const message = new Paho.MQTT.Message(mqttPayload);
        message.destinationName = `silentbridge/v2/${targetRoom}`;
        message.qos = 1;
        this.mqttClient.send(message);

        if (targetRoom !== 'GLOBAL' && !isInternal) {
          const globalMsg = new Paho.MQTT.Message(mqttPayload);
          globalMsg.destinationName = 'silentbridge/v2/GLOBAL';
          globalMsg.qos = 1;
          this.mqttClient.send(globalMsg);
        }
        dispatchedOverNetwork = true;
      } catch (e) {
        console.warn("MQTT send packet error:", e);
      }
    }

    // 3. Custom / Local Offline Hotspot WebSocket Relay
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      try {
        this.wsClient.send(payloadString);
        dispatchedOverNetwork = true;
      } catch (e) {
        console.warn("Custom WS send error:", e);
      }
    }

    // 4. Store in Offline Queue if no active network connection (Data Mule Store-and-Forward)
    if (!dispatchedOverNetwork && !isInternal && packetObj.type !== 0xFE && !packetObj.isHeartbeat) {
      const alreadyQueued = this.offlineQueue.some(p => p.msgId === packetObj.msgId && p.type === packetObj.type);
      if (!alreadyQueued) {
        this.offlineQueue.push(packetObj);
        this.saveOfflineQueue();
        console.log(`💾 Stored distress packet #${packetObj.msgId} in Offline Vault queue for store-and-forward.`);
      }
    }
  }

  handleIncoming(packetObj, transport) {
    if (!packetObj) return;

    // Reject echo packets sent by this exact device
    if (packetObj._senderDevice === this.deviceId) return;

    // Filter by room code:
    // - Receivers (Rescue HQ) accept packets from ALL rooms and areas!
    // - ACKs (0xFF) and Test Pings (0xFD) are accepted across all rooms!
    // - Packets sent to or from 'GLOBAL' are accepted by everyone!
    const isReceiver = this.role === 'receiver';
    const isAckOrPing = packetObj.type === 0xFF || packetObj.type === 0xFD || packetObj.isTest;
    const isGlobal = !packetObj._room || packetObj._room === 'GLOBAL' || this.roomCode === 'GLOBAL';

    if (!isReceiver && !isAckOrPing && !isGlobal && packetObj._room !== this.roomCode) {
      return;
    }

    // Handle Heartbeat / Ping
    if (packetObj.type === 0xFE || packetObj.isHeartbeat) {
      this.recordPeer(packetObj._senderDevice, packetObj.role || packetObj._senderRole);
      return;
    }

    // Autonomous Multi-Hop Mesh Relay Forwarder:
    // Enables messages to reach Rescuer across large distances (neighborhoods, campuses, disaster zones)
    if (this.enableRelay && packetObj.type !== 0xFE && !packetObj.isHeartbeat) {
      const remainingTtl = (packetObj.ttl !== undefined) ? Number(packetObj.ttl) : 10;
      const relayKey = `relay_${packetObj.msgId}_${packetObj.type}`;

      if (remainingTtl > 1 && !this.relayedPackets.has(relayKey)) {
        this.relayedPackets.add(relayKey);
        if (this.relayedPackets.size > 200) {
          const first = this.relayedPackets.values().next().value;
          this.relayedPackets.delete(first);
        }

        const forwardPacket = {
          ...packetObj,
          ttl: remainingTtl - 1,
          hops: (packetObj.hops || 0) + 1,
          relayedBy: this.deviceId,
          relayPath: [...(packetObj.relayPath || []), this.deviceId.slice(0, 7)],
          _isRelayHop: true
        };

        // Randomized jitter delay (200-600ms) to prevent collision storms
        const jitter = Math.floor(Math.random() * 400 + 200);
        setTimeout(() => {
          console.log(`📡 Autonomous Mesh Relay: Forwarding beacon #${packetObj.msgId} (Hop ${forwardPacket.hops}, TTL ${forwardPacket.ttl}) across airwaves and local mesh`);
          this.sendPacket(forwardPacket, true);
          if (this.onRelayForward) {
            this.onRelayForward(forwardPacket);
          }
        }, jitter);
      }
    }

    // Deduplicate incoming SOS / ACK packets, BUT permit voice enrichment
    const packetKey = `${packetObj.msgId || '0'}_${packetObj.type}_${packetObj.isTest ? 'test' : 'sos'}`;
    const hasVoice = Boolean(packetObj.voiceAudio || packetObj.ackVoiceAudio);
    if (!this.seenPacketsWithVoice) this.seenPacketsWithVoice = new Set();

    if (this.seenPacketIds.has(packetKey)) {
      if (hasVoice && !this.seenPacketsWithVoice.has(packetKey)) {
        this.seenPacketsWithVoice.add(packetKey);
        console.log(`🎙️ MeshBridge: Passing voice-enriched packet #${packetObj.msgId} to application handler.`);
        if (this.onPacket) {
          this.onPacket(packetObj, transport);
        }
      }
      return;
    }

    this.seenPacketIds.add(packetKey);
    if (hasVoice) {
      this.seenPacketsWithVoice.add(packetKey);
    }

    if (this.seenPacketIds.size > 200) {
      const first = this.seenPacketIds.values().next().value;
      this.seenPacketIds.delete(first);
    }

    // Record sender device presence
    if (packetObj._senderDevice) {
      this.recordPeer(packetObj._senderDevice, packetObj._senderRole);
    }

    // Forward to app handler
    if (this.onPacket) {
      this.onPacket(packetObj, transport);
    }
  }

  recordPeer(peerId, peerRole) {
    if (!peerId) return;
    this.peers.set(peerId, {
      role: peerRole || 'unknown',
      lastSeen: Date.now()
    });
    this.notifyPeers();
  }

  pruneOldPeers() {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > 35000) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.notifyPeers();
  }

  notifyStatus(state, message) {
    if (this.onStatus) {
      this.onStatus({
        state,
        message,
        room: this.roomCode,
        cloudConnected: this.cloudConnected,
        wsConnected: this.wsConnected,
        peerCount: this.peers.size
      });
    }
  }

  notifyPeers() {
    if (this.onPeersChange) {
      this.onPeersChange({
        count: this.peers.size,
        peers: Array.from(this.peers.values())
      });
    }
  }

  getStatus() {
    return {
      room: this.roomCode,
      deviceId: this.deviceId,
      role: this.role,
      cloudConnected: this.cloudConnected,
      wsConnected: this.wsConnected,
      peerCount: this.peers.size,
      broker: this.activeBrokers[this.currentBrokerIndex]?.name || 'Unknown',
      customWsUrl: this.customWsUrl,
      enableRelay: this.enableRelay,
      maxMeshHops: this.maxMeshHops
    };
  }
}

if (typeof window !== 'undefined') {
  window.SilentBridgeMesh = SilentBridgeMesh;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SilentBridgeMesh;
}
