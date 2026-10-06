// meshBridge.js - Multi-Transport Real-Time Cross-Device Relay for SilentBridge
// Supports: Cloud WSS MQTT (EMQX + HiveMQ Fallback), Custom WebSocket Relay, and BroadcastChannel

class SilentBridgeMesh {
  constructor(options = {}) {
    this.deviceId = options.deviceId || 'sb_' + Math.random().toString(36).substring(2, 9);
    this.roomCode = (options.roomCode || this.getInitialRoomCode()).toUpperCase();
    this.role = options.role || 'sender';

    this.onPacket = options.onPacket || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.onPeersChange = options.onPeersChange || (() => {});

    this.cloudConnected = false;
    this.wsConnected = false;

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
    this.customWsUrl = options.customWsUrl || this.getInitialWsUrl();

    this.initBroadcastChannel();
    this.initCloudMqtt();
    if (this.customWsUrl) {
      this.initCustomWs();
    }
    this.startHeartbeat();
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

    const broker = this.activeBrokers[0]; // Unified primary broker across all devices
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
        },
        onFailure: (err) => {
          this.cloudConnected = false;
          console.warn(`Failed to connect to ${broker.name}:`, err);
          setTimeout(() => this.initCloudMqtt(), 3000);
        }
      });
    } catch (err) {
      console.warn("MQTT init error:", err);
      setTimeout(() => this.initCloudMqtt(), 4000);
    }
  }

  initCustomWs(customUrl) {
    if (customUrl) this.customWsUrl = customUrl;
    if (!this.customWsUrl) return;

    try {
      console.log("Connecting to custom WebSocket relay:", this.customWsUrl);
      this.wsClient = new WebSocket(this.customWsUrl);

      this.wsClient.onopen = () => {
        this.wsConnected = true;
        console.log("✅ Custom WebSocket connected:", this.customWsUrl);
        this.sendPing();
      };

      this.wsClient.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data) this.handleIncoming(data, 'custom_ws');
        } catch (e) {
          console.warn("Custom WS message parse error:", e);
        }
      };

      this.wsClient.onerror = (e) => {
        this.wsConnected = false;
        console.warn("Custom WS error:", e);
      };

      this.wsClient.onclose = () => {
        this.wsConnected = false;
        setTimeout(() => {
          if (this.customWsUrl) this.initCustomWs();
        }, 5000);
      };
    } catch (e) {
      console.warn("Custom WS init error:", e);
    }
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Send ping every 8 seconds to prevent mobile carrier NAT socket timeouts
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
      timestamp: timeStr
    });
    return testId;
  }

  sendPacket(packetObj, isInternal = false) {
    packetObj._senderDevice = this.deviceId;
    packetObj._senderRole = this.role;
    packetObj._room = this.roomCode;
    packetObj._txTime = Date.now();

    const payloadString = JSON.stringify(packetObj);

    // 1. Same-device BroadcastChannel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(packetObj);
      } catch (e) {}
    }

    // 2. Cloud Mesh MQTT (Cross-Device across anywhere in the world)
    if (this.mqttClient && this.cloudConnected) {
      try {
        // Support voice audio memos up to 200KB over WSS MQTT
        const mqttPacket = { ...packetObj };
        if (mqttPacket.voiceAudio && mqttPacket.voiceAudio.length > 200000) {
          mqttPacket.hasVoice = true;
          mqttPacket.voiceAudio = null;
        }
        if (mqttPacket.ackVoiceAudio && mqttPacket.ackVoiceAudio.length > 200000) {
          mqttPacket.hasAckVoice = true;
          mqttPacket.ackVoiceAudio = null;
        }

        const mqttPayload = JSON.stringify(mqttPacket);
        const targetRoom = packetObj._room || this.roomCode || 'GLOBAL';

        // Publish to room topic with QoS 1 guaranteed delivery
        const message = new Paho.MQTT.Message(mqttPayload);
        message.destinationName = `silentbridge/v2/${targetRoom}`;
        message.qos = 1;
        this.mqttClient.send(message);

        // Also broadcast to GLOBAL so any rescuer picks it up instantly
        if (targetRoom !== 'GLOBAL' && !isInternal) {
          const globalMsg = new Paho.MQTT.Message(mqttPayload);
          globalMsg.destinationName = 'silentbridge/v2/GLOBAL';
          globalMsg.qos = 1;
          this.mqttClient.send(globalMsg);
        }
      } catch (e) {
        console.warn("MQTT send packet error:", e);
      }
    }

    // 3. Custom / Local WebSocket
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      try {
        this.wsClient.send(payloadString);
      } catch (e) {
        console.warn("Custom WS send error:", e);
      }
    }
  }

  handleIncoming(packetObj, transport) {
    if (!packetObj) return;

    // Reject echo packets sent by this exact device
    if (packetObj._senderDevice === this.deviceId) return;

    // Filter by room code:
    // - Receivers (Rescue HQ) accept packets from ALL rooms/areas!
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

    // Deduplicate incoming SOS / ACK packets
    const packetKey = `${packetObj.msgId || '0'}_${packetObj.type}_${packetObj.isTest ? 'test' : 'sos'}`;
    if (this.seenPacketIds.has(packetKey)) return;
    this.seenPacketIds.add(packetKey);

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
      broker: this.activeBrokers[this.currentBrokerIndex]?.name || 'Unknown'
    };
  }
}

if (typeof window !== 'undefined') {
  window.SilentBridgeMesh = SilentBridgeMesh;
}
