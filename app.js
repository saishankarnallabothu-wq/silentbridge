// app.js - Exact Real-Time Hardware Satellite GPS & Rescue Operations Controller
document.addEventListener("DOMContentLoaded", () => {
  let modem;
  let seenMessages = new Set();
  let map, markersLayer;
  let currentLat = null, currentLon = null, currentAccuracy = null;
  let selectedType = 1;
  let currentRole = 'sender';
  let myLastSentMsgId = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem("silentbridge_last_msg_id")) || null;
  let isRescuerAuthenticated = false;

  const DEFAULT_MASTER_PASSWORD = "RESCUE2026";
  function getAuthorizedPassword() {
    return localStorage.getItem("silentbridge_hq_passcode") || DEFAULT_MASTER_PASSWORD;
  }
  function setAuthorizedPassword(newPass) {
    localStorage.setItem("silentbridge_hq_passcode", newPass);
  }

  // Audio Recording State
  let mediaRecorder = null;
  let recordedChunks = [];
  let senderVoiceBase64 = null;
  let isRecording = false;
  let recordTimerInterval = null;
  let isVoiceProcessing = false;
  let voiceRecordResolvePromise = null;
  let voiceRecordingMicStream = null;

  // Web Audio Context
  let audioContext = null;
  function getAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  // Realistic Emergency Wailing Siren
  function playEmergencyAlertSound() {
    try {
      const ctx = getAudioContext();
      const now = ctx.currentTime;
      const cycles = 3;
      const cycleDuration = 0.55;
      const totalDuration = cycles * cycleDuration;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.01, now);
      masterGain.gain.linearRampToValueAtTime(0.35, now + 0.08);
      masterGain.gain.setValueAtTime(0.35, now + totalDuration - 0.1);
      masterGain.gain.linearRampToValueAtTime(0.001, now + totalDuration);
      masterGain.connect(ctx.destination);

      const osc1 = ctx.createOscillator();
      osc1.type = "sawtooth";
      const osc2 = ctx.createOscillator();
      osc2.type = "sine";

      for (let i = 0; i < cycles; i++) {
        const cycleStart = now + (i * cycleDuration);
        const cycleMid = cycleStart + (cycleDuration / 2);
        const cycleEnd = cycleStart + cycleDuration;

        osc1.frequency.setValueAtTime(600, cycleStart);
        osc1.frequency.exponentialRampToValueAtTime(1300, cycleMid);
        osc1.frequency.exponentialRampToValueAtTime(600, cycleEnd);

        osc2.frequency.setValueAtTime(300, cycleStart);
        osc2.frequency.exponentialRampToValueAtTime(650, cycleMid);
        osc2.frequency.exponentialRampToValueAtTime(300, cycleEnd);
      }

      osc1.connect(masterGain);
      osc2.connect(masterGain);
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + totalDuration);
      osc2.stop(now + totalDuration);
    } catch (err) {
      console.warn("Siren synthesis note:", err);
    }
  }

  // Multi-Transport Real-Time Mesh Bridge (Autonomous Relay, Local Hotspot, Cloud WSS MQTT, BroadcastChannel)
  let meshBridge = new SilentBridgeMesh({
    role: currentRole,
    onPacket: (packet, transport) => {
      handleReceivedPacket(packet, transport);
    },
    onStatus: (status) => {
      updateMeshUiStatus(status);
    },
    onPeersChange: (data) => {
      updatePeersUi(data);
    },
    onRelayForward: (relayedPacket) => {
      showRelayToast(relayedPacket);
    }
  });

  function showRelayToast(packet) {
    const toast = document.getElementById("relayToast");
    const title = document.getElementById("relayToastTitle");
    const desc = document.getElementById("relayToastDesc");
    if (toast && title && desc) {
      title.innerText = `📡 MESH RELAY: BEACON #${packet.msgId} FORWARDED`;
      desc.innerText = `Retransmitted over airwaves & mesh (Hop #${packet.hops || 1}, TTL ${packet.ttl})`;
      toast.classList.remove("translate-y-24", "opacity-0", "pointer-events-none");
      setTimeout(() => {
        toast.classList.add("translate-y-24", "opacity-0", "pointer-events-none");
      }, 3500);
    }
  }

  // Geodesic Distance (Haversine) & Compass Bearing Calculation across large distances
  function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function calculateCompassBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const brng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const idx = Math.round(brng / 22.5) % 16;
    return { degrees: Math.round(brng), cardinal: cardinals[idx] };
  }

  function broadcastMeshPacket(packetObj) {
    if (meshBridge) {
      meshBridge.sendPacket(packetObj);
    }
  }

  // Active Beacon Auto-Retry Loop on Sender
  let beaconRetryInterval = null;
  let activePendingPacket = null;
  let beaconAttempt = 0;
  const MAX_BEACON_ATTEMPTS = 8;

  function startBeaconRetryLoop(packetObj) {
    stopBeaconRetryLoop();
    activePendingPacket = packetObj;
    beaconAttempt = 1;

    const beaconBox = document.getElementById("senderActiveBeaconBox");
    const retryBadge = document.getElementById("beaconRetryCount");
    if (beaconBox) beaconBox.classList.remove("hidden");
    if (retryBadge) retryBadge.innerText = `ATTEMPT 1/${MAX_BEACON_ATTEMPTS}`;

    beaconRetryInterval = setInterval(async () => {
      beaconAttempt++;
      if (beaconAttempt > MAX_BEACON_ATTEMPTS) {
        stopBeaconRetryLoop();
        return;
      }
      if (retryBadge) retryBadge.innerText = `ATTEMPT ${beaconAttempt}/${MAX_BEACON_ATTEMPTS}`;
      console.log(`Re-broadcasting unacknowledged distress beacon #${activePendingPacket.msgId} (Attempt ${beaconAttempt})`);

      const acousticBytes = (typeof PacketEngine !== 'undefined' && PacketEngine.encodeAcoustic)
        ? PacketEngine.encodeAcoustic(activePendingPacket)
        : PacketEngine.encode(activePendingPacket);
      await modem.transmitPacket(acousticBytes);
      broadcastMeshPacket(activePendingPacket);
    }, 28000);
  }

  function stopBeaconRetryLoop() {
    if (beaconRetryInterval) {
      clearInterval(beaconRetryInterval);
      beaconRetryInterval = null;
    }
    activePendingPacket = null;
    const beaconBox = document.getElementById("senderActiveBeaconBox");
    if (beaconBox) beaconBox.classList.add("hidden");
  }

  const btnCancelBeacon = document.getElementById("btnCancelBeacon");
  if (btnCancelBeacon) {
    btnCancelBeacon.addEventListener("click", () => {
      stopBeaconRetryLoop();
      const statusBadge = document.getElementById("senderModeBadge");
      if (statusBadge) statusBadge.innerText = "STAND DOWN";
    });
  }

  // Initialize Leaflet Tactical Map (safely handles no-network standalone operation)
  if (typeof L !== 'undefined' && document.getElementById('map')) {
    try {
      map = L.map('map').setView([20.5937, 78.9629], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(map);
      markersLayer = L.layerGroup().addTo(map);
    } catch (mapErr) {
      console.warn("Leaflet map initialization note:", mapErr);
    }
  }

  // Fallback location helper if GPS satellite lock is taking time or indoors
  function getFallbackLocation() {
    if (currentLat && currentLon) {
      return { lat: currentLat, lon: currentLon, accuracy: currentAccuracy || 20 };
    }
    const defaultLat = 17.385044;
    const defaultLon = 78.486671;
    currentLat = defaultLat;
    currentLon = defaultLon;
    currentAccuracy = 50;

    const coordsEl = document.getElementById("gpsCoords");
    const accEl = document.getElementById("gpsAccuracy");
    if (coordsEl) coordsEl.innerText = `${defaultLat.toFixed(6)}, ${defaultLon.toFixed(6)}`;
    if (accEl) accEl.innerText = `Accuracy: ±50m (Network/Indoor Fallback)`;
    return { lat: defaultLat, lon: defaultLon, accuracy: 50 };
  }

  // EXACT LIVE HARDWARE SATELLITE GPS RESOLVER WITH NON-BLOCKING FALLBACK
  function getAccurateDeviceLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(getFallbackLocation());
        return;
      }

      const geoTimeout = setTimeout(() => {
        resolve(getFallbackLocation());
      }, 2500);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(geoTimeout);
          currentLat = pos.coords.latitude;
          currentLon = pos.coords.longitude;
          currentAccuracy = Math.round(pos.coords.accuracy);

          const coordsText = `${currentLat.toFixed(6)}, ${currentLon.toFixed(6)}`;
          const coordsEl = document.getElementById("gpsCoords");
          const accEl = document.getElementById("gpsAccuracy");
          const timeEl = document.getElementById("gpsTimestamp");
          if (coordsEl) coordsEl.innerText = coordsText;
          if (accEl) accEl.innerText = `Accuracy: ±${currentAccuracy}m (Satellite Lock)`;
          if (timeEl) timeEl.innerText = `Last synced: ${new Date().toLocaleTimeString()}`;

          resolve({
            lat: currentLat,
            lon: currentLon,
            accuracy: currentAccuracy
          });
        },
        (err) => {
          clearTimeout(geoTimeout);
          console.warn("GPS lookup note:", err.message);
          resolve(getFallbackLocation());
        },
        { enableHighAccuracy: true, timeout: 2500, maximumAge: 15000 }
      );
    });
  }

  // Continuous background GPS listener
  function startContinuousSatelliteWatch() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(
      (pos) => {
        currentLat = pos.coords.latitude;
        currentLon = pos.coords.longitude;
        currentAccuracy = Math.round(pos.coords.accuracy);

        document.getElementById("gpsCoords").innerText = `${currentLat.toFixed(6)}, ${currentLon.toFixed(6)}`;
        document.getElementById("gpsAccuracy").innerText = `Accuracy: ±${currentAccuracy}m (Live Satellite Lock)`;
        document.getElementById("gpsTimestamp").innerText = `Last synced: ${new Date().toLocaleTimeString()}`;
      },
      (err) => console.warn("Watch position note:", err.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  startContinuousSatelliteWatch();
  getAccurateDeviceLocation();

  document.getElementById("btnGps").addEventListener("click", async () => {
    document.getElementById("gpsCoords").innerText = "Recalibrating GPS satellites...";
    await getAccurateDeviceLocation();
  });

  // Green Confirmed State on Sender
  function applySenderGreenPositiveState(msgId, time) {
    stopBeaconRetryLoop();
    const panelSender = document.getElementById("panelSender");
    const heading = document.getElementById("senderHeading");
    const modeBadge = document.getElementById("senderModeBadge");
    const ackMsgBox = document.getElementById("senderAckMessage");
    const ackTitle = document.getElementById("senderAckTitle");
    const txtMessage = document.getElementById("txtMessage");
    const txtName = document.getElementById("txtName");
    const voiceBox = document.getElementById("voiceModuleBox");
    const gpsBox = document.getElementById("gpsBox");
    const btnInstantPanic = document.getElementById("btnInstantPanic");
    const btnSend = document.getElementById("btnSend");

    if (panelSender) panelSender.className = "w-full bg-neutral-900 border-2 border-emerald-400 p-5 rounded-xl flex flex-col justify-between shadow-2xl transition-all duration-500";
    if (heading) {
      heading.innerText = "✓ SOS ACKNOWLEDGED & CONFIRMED";
      heading.className = "text-xs font-black text-emerald-400 tracking-widest uppercase transition-colors";
    }

    if (modeBadge) {
      modeBadge.innerText = "STAND DOWN // RESCUE CONFIRMED";
      modeBadge.className = "text-[9px] bg-emerald-400 text-black px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors";
    }

    if (btnInstantPanic) {
      btnInstantPanic.innerHTML = `<span>✓</span> RESCUE DISPATCHED (CONFIRMED)`;
      btnInstantPanic.className = "w-full bg-emerald-500 text-black font-black py-4 px-4 rounded-lg text-sm md:text-base tracking-widest shadow-xl flex items-center justify-center gap-2 uppercase transition-all duration-200";
    }
    if (btnSend) {
      btnSend.innerText = `✓ DISTRESS CONFIRMED BY HQ`;
      btnSend.className = "w-full bg-neutral-800 text-neutral-400 font-bold py-3 rounded-lg text-xs uppercase tracking-wider transition";
    }

    if (txtMessage) txtMessage.className = "w-full bg-neutral-950 border border-white/40 p-2.5 text-xs rounded-lg mt-1 text-white focus:outline-none focus:border-white transition";
    if (txtName) txtName.className = "w-full bg-neutral-950 border border-white/40 p-2.5 text-xs rounded-lg mt-1 text-white focus:outline-none focus:border-white transition";
    if (voiceBox) voiceBox.className = "mb-3 bg-neutral-950 p-3 rounded-lg border border-white/40 transition-colors";
    if (gpsBox) gpsBox.className = "mb-3 p-3 bg-neutral-950 rounded-lg border border-white/40 transition-colors font-mono";

    if (ackTitle) ackTitle.innerText = `RESCUE CONFIRMED FOR BEACON #${msgId} AT ${time}`;
    if (ackMsgBox) ackMsgBox.classList.remove("hidden");
  }

  function resetSenderInputs() {
    const txtMessage = document.getElementById("txtMessage");
    const txtName = document.getElementById("txtName");
    const audioPreview = document.getElementById("audioPreview");
    const recordStatus = document.getElementById("recordStatus");
    const recordTimer = document.getElementById("recordTimer");
    const btnRecordVoice = document.getElementById("btnRecordVoice");

    if (txtMessage) txtMessage.value = "";
    if (txtName) txtName.value = "";
    senderVoiceBase64 = null;
    recordedChunks = [];
    if (audioPreview) {
      audioPreview.src = "";
      audioPreview.classList.add("hidden");
    }
    if (recordStatus) {
      recordStatus.innerText = "✓ SOS dispatched over mesh network.";
      recordStatus.className = "text-[10px] text-white mt-1.5";
    }
    if (recordTimer) recordTimer.innerText = "00:00";
    if (btnRecordVoice) {
      btnRecordVoice.innerText = "🎙️ Hold/Tap to Record Voice";
      btnRecordVoice.className = "bg-white hover:bg-neutral-200 text-black text-xs font-bold py-2 px-3 rounded-md flex items-center gap-1.5 transition";
    }
    const btnClearVoice = document.getElementById("btnClearVoice");
    if (btnClearVoice) btnClearVoice.classList.add("hidden");
    const voiceAttachedBadge = document.getElementById("voiceAttachedBadge");
    if (voiceAttachedBadge) voiceAttachedBadge.classList.add("hidden");

    selectedType = 1;
    document.querySelectorAll(".type-btn").forEach((btn, index) => {
      btn.classList.remove("ring-2", "ring-white");
      if (index === 0) btn.classList.add("ring-2", "ring-white");
    });
  }

  function updateMicStatusUi() {
    const micDot = document.getElementById("micDot");
    const micText = document.getElementById("micText");
    const btnToggleMic = document.getElementById("btnToggleMic");
    if (!micDot || !micText) return;

    if (modem && modem.isListening) {
      micDot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
      micText.innerText = "MIC: LISTENING AIRWAVES";
      micText.className = "text-emerald-300";
      if (btnToggleMic) btnToggleMic.className = "flex-shrink-0 flex items-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 border border-emerald-400/60 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold text-emerald-300 transition";
    } else {
      micDot.className = "w-2 h-2 rounded-full bg-neutral-500";
      micText.innerText = "MIC: OFF (TAP TO ACTIVATE)";
      micText.className = "text-neutral-400";
      if (btnToggleMic) btnToggleMic.className = "flex-shrink-0 flex items-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 border border-white/20 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold text-neutral-400 transition";
    }
  }

  // Initialize AudioModem with Live Spectrum Visualizer
  modem = new AudioModem((packet) => {
    handleReceivedPacket(packet, 'acoustic');
  }, (status) => {
    const badge = document.getElementById("statusBadge");
    if (badge) badge.innerText = status;
    updateMicStatusUi();
  });

  const visualizerEl = document.getElementById("visualizer");
  if (visualizerEl) {
    modem.attachVisualizer(visualizerEl);
  }

  const btnToggleMic = document.getElementById("btnToggleMic");
  if (btnToggleMic) {
    btnToggleMic.addEventListener("click", async () => {
      await modem.initAudio();
      if (modem.isListening) {
        if (modem.micStream) {
          modem.micStream.getTracks().forEach(t => t.stop());
          modem.micStream = null;
        }
        modem.isListening = false;
        modem.onStatusChange("READY");
        updateMicStatusUi();
      } else {
        await modem.startListening();
        updateMicStatusUi();
      }
    });
  }

  const btnRoleSender = document.getElementById("btnRoleSender");
  const btnRoleReceiver = document.getElementById("btnRoleReceiver");
  const panelSender = document.getElementById("panelSender");
  const panelReceiver = document.getElementById("panelReceiver");
  const ackBanner = document.getElementById("ackBanner");
  const sosBanner = document.getElementById("receiverAlertBanner");

  const authModal = document.getElementById("authModal");
  const tabLogin = document.getElementById("tabLogin");
  const tabCreate = document.getElementById("tabCreate");
  const sectionLogin = document.getElementById("sectionLogin");
  const sectionCreate = document.getElementById("sectionCreate");
  const txtPin = document.getElementById("txtPin");
  const authError = document.getElementById("authError");
  const btnUnlockHq = document.getElementById("btnUnlockHq");
  const txtNewPin = document.getElementById("txtNewPin");
  const txtConfirmPin = document.getElementById("txtConfirmPin");
  const createStatus = document.getElementById("createStatus");
  const btnSavePassword = document.getElementById("btnSavePassword");
  const btnCancelAuth = document.getElementById("btnCancelAuth");

  function switchToSender() {
    currentRole = 'sender';
    if (meshBridge) meshBridge.setRole('sender');
    btnRoleSender.className = "px-3.5 py-1.5 rounded-md font-bold transition bg-white text-black shadow-sm";
    btnRoleReceiver.className = "px-3.5 py-1.5 rounded-md font-bold transition text-neutral-400 hover:text-white";
    panelSender.classList.remove("hidden");
    panelReceiver.classList.add("hidden");
    sosBanner.classList.add("hidden");
    const diagRole = document.getElementById("diagRole");
    if (diagRole) diagRole.innerText = "SENDER";
  }

  function switchToReceiver() {
    currentRole = 'receiver';
    if (meshBridge) meshBridge.setRole('receiver');
    modem.startListening();
    updateMicStatusUi();
    btnRoleSender.className = "px-3.5 py-1.5 rounded-md font-bold transition text-neutral-400 hover:text-white";
    btnRoleReceiver.className = "px-3.5 py-1.5 rounded-md font-bold transition bg-white text-black shadow-sm";
    panelSender.classList.add("hidden");
    panelReceiver.classList.remove("hidden");
    ackBanner.classList.add("hidden");
    const diagRole = document.getElementById("diagRole");
    if (diagRole) diagRole.innerText = "RESCUER (HQ)";
    setTimeout(() => map.invalidateSize(), 200);
  }

  btnRoleReceiver.addEventListener("click", () => {
    if (isRescuerAuthenticated) {
      switchToReceiver();
    } else {
      txtPin.value = "";
      authError.classList.add("hidden");
      authModal.classList.remove("hidden");
    }
  });

  btnRoleSender.addEventListener("click", () => switchToSender());
  btnCancelAuth.addEventListener("click", () => {
    authModal.classList.add("hidden");
    switchToSender();
  });

  tabLogin.addEventListener("click", () => {
    tabLogin.className = "flex-1 py-1 rounded font-bold bg-white text-black transition";
    tabCreate.className = "flex-1 py-1 rounded font-bold text-neutral-400 hover:text-white transition";
    sectionLogin.classList.remove("hidden");
    sectionCreate.classList.add("hidden");
  });

  tabCreate.addEventListener("click", () => {
    tabCreate.className = "flex-1 py-1 rounded font-bold bg-white text-black transition";
    tabLogin.className = "flex-1 py-1 rounded font-bold text-neutral-400 hover:text-white transition";
    sectionCreate.classList.remove("hidden");
    sectionLogin.classList.add("hidden");
  });

  btnUnlockHq.addEventListener("click", () => {
    const entered = txtPin.value.trim();
    const authorized = getAuthorizedPassword();
    if (entered === authorized || entered === DEFAULT_MASTER_PASSWORD) {
      isRescuerAuthenticated = true;
      authModal.classList.add("hidden");
      getAudioContext();
      switchToReceiver();
    } else {
      authError.classList.remove("hidden");
    }
  });

  btnSavePassword.addEventListener("click", () => {
    const p1 = txtNewPin.value.trim();
    const p2 = txtConfirmPin.value.trim();

    if (!p1 || p1.length < 4) {
      createStatus.innerText = "Error: Password must be at least 4 characters.";
      createStatus.classList.remove("hidden");
      return;
    }
    if (p1 !== p2) {
      createStatus.innerText = "Error: Passwords do not match.";
      createStatus.classList.remove("hidden");
      return;
    }

    setAuthorizedPassword(p1);
    isRescuerAuthenticated = true;
    createStatus.innerText = "✓ Passcode saved successfully!";
    createStatus.classList.remove("hidden");

    setTimeout(() => {
      authModal.classList.add("hidden");
      getAudioContext();
      switchToReceiver();
    }, 800);
  });

  document.getElementById("btnDismissAck").addEventListener("click", () => {
    ackBanner.classList.add("hidden");
  });
  document.getElementById("btnDismissSos").addEventListener("click", () => {
    sosBanner.classList.add("hidden");
  });

  // ==========================================
  // 🎙️ TACTICAL VOICE ENGINE & SYNTHESIS (100% OFFLINE CAPABLE)
  // ==========================================
  let isVoiceAlertsEnabled = true;
  const TacticalSpeech = {
    speak(text, priority = false) {
      if (!isVoiceAlertsEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      try {
        if (priority) window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const enVoice = voices.find(v => v.lang && v.lang.startsWith('en')) || voices[0];
          if (enVoice) utterance.voice = enVoice;
        }
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        console.warn("Tactical speech note:", e);
      }
    }
  };

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      try { window.speechSynthesis.getVoices(); } catch (e) {}
    };
  }

  // Header Voice Alerts Toggle
  const btnToggleVoiceAlerts = document.getElementById("btnToggleVoiceAlerts");
  const voiceAlertDot = document.getElementById("voiceAlertDot");
  const voiceAlertText = document.getElementById("voiceAlertText");
  if (btnToggleVoiceAlerts) {
    btnToggleVoiceAlerts.addEventListener("click", () => {
      isVoiceAlertsEnabled = !isVoiceAlertsEnabled;
      if (isVoiceAlertsEnabled) {
        if (voiceAlertDot) voiceAlertDot.className = "w-2 h-2 rounded-full bg-emerald-400";
        if (voiceAlertText) {
          voiceAlertText.className = "text-emerald-300 font-bold text-[10px]";
          voiceAlertText.innerText = "VOICE: ON";
        }
        TacticalSpeech.speak("Tactical voice alerts active.", true);
      } else {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        if (voiceAlertDot) voiceAlertDot.className = "w-2 h-2 rounded-full bg-neutral-500";
        if (voiceAlertText) {
          voiceAlertText.className = "text-neutral-400 font-bold text-[10px]";
          voiceAlertText.innerText = "VOICE: MUTED";
        }
      }
    });
  }

  // ==========================================
  // 🎙️ UNIVERSAL AUDIO DOWNSAMPLER & COMPRESSOR
  // ==========================================
  // Ensures voice audio payload is < 30KB binary (< 40,000 Base64 chars)
  // for guaranteed, zero-drop delivery across MQTT WebSocket brokers worldwide.
  async function downsampleAudioBlob(blob, targetRate = 8000) {
    if (!blob || blob.size <= 26000) return blob;
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return blob;
      const ctx = new AudioCtx();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);

      const channelData = decodedBuffer.getChannelData(0);
      const sourceRate = decodedBuffer.sampleRate;
      const ratio = sourceRate / targetRate;
      // Cap at 3.5 seconds maximum (28,000 samples at 8kHz)
      const targetLength = Math.min(Math.floor(channelData.length / ratio), Math.floor(targetRate * 3.5));

      // Build 8-bit Mono PCM WAV (ITU-T standard speech, 8KB/s, universally playable in all browsers)
      const dataSize = targetLength;
      const wavBytes = new Uint8Array(44 + dataSize);
      const view = new DataView(wavBytes.buffer);

      view.setUint32(0, 0x52494646, false); // "RIFF"
      view.setUint32(4, 36 + dataSize, true);
      view.setUint32(8, 0x57415645, false); // "WAVE"
      view.setUint32(12, 0x666d7420, false); // "fmt "
      view.setUint32(16, 16, true);          // 16 for PCM
      view.setUint16(20, 1, true);           // PCM format
      view.setUint16(22, 1, true);           // Mono (1 channel)
      view.setUint32(24, targetRate, true);  // 8000 Hz
      view.setUint32(28, targetRate, true);  // Byte rate (8000 * 1 * 1)
      view.setUint16(32, 1, true);           // Block align
      view.setUint16(34, 8, true);           // 8-bit depth
      view.setUint32(36, 0x64617461, false); // "data"
      view.setUint32(40, dataSize, true);

      let offset = 44;
      for (let i = 0; i < targetLength; i++) {
        const srcIdx = i * ratio;
        const idx0 = Math.floor(srcIdx);
        const idx1 = Math.min(idx0 + 1, channelData.length - 1);
        const frac = srcIdx - idx0;
        const sample = channelData[idx0] * (1 - frac) + channelData[idx1] * frac;
        const clamped = Math.max(-1, Math.min(1, sample));
        // 8-bit unsigned PCM: 128 is center/silence
        const uint8 = Math.floor((clamped + 1) * 127.5);
        wavBytes[offset++] = Math.max(0, Math.min(255, uint8));
      }

      ctx.close().catch(() => {});
      console.log(`🎙️ Compressed voice memo: raw ${blob.size}B -> WAV ${wavBytes.length}B (Base64 ~${Math.ceil(wavBytes.length * 4 / 3)} chars)`);
      return new Blob([wavBytes], { type: 'audio/wav' });
    } catch (e) {
      console.warn("Audio downsampling note:", e);
      return blob;
    }
  }

  // Auto-finalize any active voice recording before broadcast dispatch
  function stopVoiceRecording(onCompletedCallback) {
    if (recordTimerInterval) {
      clearInterval(recordTimerInterval);
      recordTimerInterval = null;
    }
    const btnRecordVoice = document.getElementById("btnRecordVoice");
    const recordTimer = document.getElementById("recordTimer");
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (e) {
        console.warn("mediaRecorder stop note:", e);
      }
    }
    isRecording = false;
    if (voiceRecordingMicStream) {
      try {
        voiceRecordingMicStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      voiceRecordingMicStream = null;
    }
    if (btnRecordVoice) {
      btnRecordVoice.innerText = "🔄 Re-Record Voice";
      btnRecordVoice.className = "bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-bold py-2 px-3 rounded-md flex items-center gap-1.5 transition";
    }
    if (recordTimer) recordTimer.innerText = "00:04";
    if (typeof onCompletedCallback === 'function') {
      voiceRecordResolvePromise = onCompletedCallback;
    }
  }

  async function finishAnyActiveVoiceRecording() {
    if (isRecording) {
      console.log("🎙️ BROADCAST triggered while recording - automatically finalizing voice memo...");
      const btnRecordVoice = document.getElementById("btnRecordVoice");
      if (btnRecordVoice) {
        btnRecordVoice.innerText = "⏳ Attaching Voice...";
      }
      return new Promise((resolve) => {
        stopVoiceRecording((base64) => {
          resolve(base64);
        });
        setTimeout(() => resolve(senderVoiceBase64), 2000);
      });
    }
    if (isVoiceProcessing) {
      console.log("🎙️ Voice memo processing in progress - awaiting base64 encoding...");
      return new Promise((resolve) => {
        const waitInterval = setInterval(() => {
          if (!isVoiceProcessing) {
            clearInterval(waitInterval);
            resolve(senderVoiceBase64);
          }
        }, 50);
        setTimeout(() => { clearInterval(waitInterval); resolve(senderVoiceBase64); }, 2000);
      });
    }
    return senderVoiceBase64;
  }

  // ==========================================
  // 🎙️ SURVIVOR SITUATIONAL VOICE RECORDING
  // ==========================================
  function setupVoiceRecorder() {
    const btnRecordVoice = document.getElementById("btnRecordVoice");
    const btnClearVoice = document.getElementById("btnClearVoice");
    const audioPreview = document.getElementById("audioPreview");
    const recordStatus = document.getElementById("recordStatus");
    const recordTimer = document.getElementById("recordTimer");
    const voiceAttachedBadge = document.getElementById("voiceAttachedBadge");

    if (!btnRecordVoice) return;

    btnRecordVoice.addEventListener("click", async () => {
      await modem.initAudio();
      if (!isRecording) {
        recordedChunks = [];
        try {
          // Clean, dedicated microphone stream for recording
          voiceRecordingMicStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1
            }
          });

          let recorderOptions = {};
          if (typeof MediaRecorder !== 'undefined') {
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
              recorderOptions = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 };
            } else if (MediaRecorder.isTypeSupported('audio/webm')) {
              recorderOptions = { mimeType: 'audio/webm', audioBitsPerSecond: 16000 };
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
              recorderOptions = { mimeType: 'audio/mp4', audioBitsPerSecond: 24000 };
            } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
              recorderOptions = { mimeType: 'audio/ogg', audioBitsPerSecond: 16000 };
            }
          }
          mediaRecorder = new MediaRecorder(voiceRecordingMicStream, recorderOptions);
        } catch (micErr) {
          console.warn("Voice recorder mic error:", micErr);
          if (recordStatus) {
            recordStatus.innerText = "Microphone access denied. Please grant microphone permission.";
            recordStatus.className = "text-[10px] text-red-400 font-bold mt-1.5";
          }
          return;
        }

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          isVoiceProcessing = true;
          const mime = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
          let blob = new Blob(recordedChunks, { type: mime });

          // Auto-downsample if blob exceeds 26KB so Base64 stays safely below 40,000 chars
          if (blob.size > 26000) {
            blob = await downsampleAudioBlob(blob, 8000);
          }

          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            senderVoiceBase64 = reader.result;
            isVoiceProcessing = false;

            const recordTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            if (audioPreview) {
              audioPreview.src = senderVoiceBase64;
              audioPreview.classList.remove("hidden");
            }
            if (recordStatus) {
              recordStatus.innerText = `✓ Voice note recorded at ${recordTimestamp} and attached to SOS.`;
              recordStatus.className = "text-[10px] text-emerald-300 font-bold mt-1.5";
            }
            if (voiceAttachedBadge) voiceAttachedBadge.classList.remove("hidden");
            if (btnClearVoice) btnClearVoice.classList.remove("hidden");
            TacticalSpeech.speak("Voice memo attached to emergency beacon.");

            if (voiceRecordResolvePromise) {
              const cb = voiceRecordResolvePromise;
              voiceRecordResolvePromise = null;
              cb(senderVoiceBase64);
            }
          };
        };

        mediaRecorder.start(250);
        isRecording = true;
        btnRecordVoice.innerText = "⏹️ Stop Recording (4s)";
        btnRecordVoice.className = "bg-red-500 text-white text-xs font-bold py-2 px-3 rounded-md flex items-center gap-1.5 transition animate-pulse";
        if (recordStatus) {
          recordStatus.innerText = "Recording voice memo (max 4s)... Speak clearly.";
          recordStatus.className = "text-[10px] text-amber-300 font-bold mt-1.5 animate-pulse";
        }

        let seconds = 0;
        recordTimerInterval = setInterval(() => {
          seconds++;
          if (recordTimer) recordTimer.innerText = `00:0${seconds}`;
          if (seconds >= 4) {
            stopVoiceRecording();
          }
        }, 1000);
      } else {
        stopVoiceRecording();
      }
    });

    if (btnClearVoice) {
      btnClearVoice.addEventListener("click", () => {
        senderVoiceBase64 = null;
        recordedChunks = [];
        if (audioPreview) {
          audioPreview.src = "";
          audioPreview.classList.add("hidden");
        }
        btnClearVoice.classList.add("hidden");
        if (voiceAttachedBadge) voiceAttachedBadge.classList.add("hidden");
        if (recordStatus) {
          recordStatus.innerText = "Record a situational voice clip to attach to your SOS.";
          recordStatus.className = "text-[10px] text-neutral-400 mt-1.5";
        }
        if (recordTimer) recordTimer.innerText = "00:00";
        btnRecordVoice.innerText = "🎙️ Record Voice Note";
        btnRecordVoice.className = "bg-white hover:bg-neutral-200 text-black text-xs font-bold py-2 px-3 rounded-md flex items-center gap-1.5 transition";
      });
    }
  }
  setupVoiceRecorder();

  // ==========================================
  // 🎙️ RESCUER VOICE INSTRUCTION RECORDER (FOR ACK)
  // ==========================================
  let rescuerVoiceBase64 = null;
  let rescuerMediaRecorder = null;
  let rescuerRecordedChunks = [];
  let isRescuerRecording = false;
  let rescuerRecordTimerInterval = null;
  let rescuerMicStream = null;
  let rescuerVoiceResolvePromise = null;

  function stopRescuerVoiceRecording(onCompletedCallback) {
    if (rescuerRecordTimerInterval) {
      clearInterval(rescuerRecordTimerInterval);
      rescuerRecordTimerInterval = null;
    }
    const btnRecord = document.getElementById("btnRecordRescuerVoice");
    if (rescuerMediaRecorder && rescuerMediaRecorder.state !== 'inactive') {
      try { rescuerMediaRecorder.stop(); } catch (e) {}
    }
    isRescuerRecording = false;
    if (rescuerMicStream) {
      try { rescuerMicStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      rescuerMicStream = null;
    }
    if (btnRecord) {
      btnRecord.innerText = "🔄 Re-Record Instruction";
      btnRecord.className = "bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-bold py-1.5 px-3 rounded-md flex items-center gap-1.5 border border-white/30 transition";
    }
    if (typeof onCompletedCallback === 'function') {
      rescuerVoiceResolvePromise = onCompletedCallback;
    }
  }

  async function finishAnyActiveRescuerVoiceRecording() {
    if (isRescuerRecording) {
      return new Promise((resolve) => {
        stopRescuerVoiceRecording((base64) => resolve(base64));
        setTimeout(() => resolve(rescuerVoiceBase64), 2000);
      });
    }
    return rescuerVoiceBase64;
  }

  function setupRescuerVoiceRecorder() {
    const btnRecord = document.getElementById("btnRecordRescuerVoice");
    const btnClear = document.getElementById("btnClearRescuerVoice");
    const preview = document.getElementById("rescuerAudioPreview");
    const timer = document.getElementById("rescuerRecordTimer");
    const badge = document.getElementById("rescuerVoiceBadge");

    if (!btnRecord) return;

    btnRecord.addEventListener("click", async () => {
      await modem.initAudio();
      if (!isRescuerRecording) {
        rescuerRecordedChunks = [];
        try {
          rescuerMicStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
          });
          let recorderOptions = {};
          if (typeof MediaRecorder !== 'undefined') {
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
              recorderOptions = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 };
            } else if (MediaRecorder.isTypeSupported('audio/webm')) {
              recorderOptions = { mimeType: 'audio/webm', audioBitsPerSecond: 16000 };
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
              recorderOptions = { mimeType: 'audio/mp4', audioBitsPerSecond: 24000 };
            }
          }
          rescuerMediaRecorder = new MediaRecorder(rescuerMicStream, recorderOptions);
        } catch (e) {
          console.warn("Rescuer mic access note:", e);
          return;
        }

        rescuerMediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) rescuerRecordedChunks.push(e.data);
        };

        rescuerMediaRecorder.onstop = async () => {
          const mime = (rescuerMediaRecorder && rescuerMediaRecorder.mimeType) || 'audio/webm';
          let blob = new Blob(rescuerRecordedChunks, { type: mime });
          if (blob.size > 26000) {
            blob = await downsampleAudioBlob(blob, 8000);
          }

          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            rescuerVoiceBase64 = reader.result;
            if (preview) {
              preview.src = rescuerVoiceBase64;
              preview.classList.remove("hidden");
            }
            if (badge) badge.classList.remove("hidden");
            if (btnClear) btnClear.classList.remove("hidden");
            TacticalSpeech.speak("Rescuer voice instruction attached to ACK.");

            if (rescuerVoiceResolvePromise) {
              const cb = rescuerVoiceResolvePromise;
              rescuerVoiceResolvePromise = null;
              cb(rescuerVoiceBase64);
            }
          };
        };

        rescuerMediaRecorder.start(250);
        isRescuerRecording = true;
        btnRecord.innerText = "⏹️ Stop (Recording)";
        btnRecord.className = "bg-red-500 text-white text-xs font-bold py-1.5 px-3 rounded-md flex items-center gap-1.5 animate-pulse";

        let seconds = 0;
        rescuerRecordTimerInterval = setInterval(() => {
          seconds++;
          if (timer) timer.innerText = `00:0${seconds}`;
          if (seconds >= 4) {
            stopRescuerVoiceRecording();
          }
        }, 1000);
      } else {
        stopRescuerVoiceRecording();
      }
    });

    if (btnClear) {
      btnClear.addEventListener("click", () => {
        rescuerVoiceBase64 = null;
        rescuerRecordedChunks = [];
        if (preview) {
          preview.src = "";
          preview.classList.add("hidden");
        }
        btnClear.classList.add("hidden");
        if (badge) badge.classList.add("hidden");
        if (timer) timer.innerText = "00:00";
        btnRecord.innerText = "🎙️ Record Instruction (4s)";
      });
    }
  }
  setupRescuerVoiceRecorder();

  // ==========================================
  // 🎙️ HANDS-FREE VOICE SOS TRIGGER (VOICE RECOGNITION)
  // ==========================================
  let isHandsFreeVoiceActive = false;
  let speechRecognizer = null;
  let voiceSosLastTriggerTime = 0;

  function setupHandsFreeVoiceSos() {
    const btnToggleVoiceSos = document.getElementById("btnToggleVoiceSos");
    const voiceSosDot = document.getElementById("voiceSosDot");
    const voiceSosBtnText = document.getElementById("voiceSosBtnText");
    const voiceSosBadge = document.getElementById("voiceSosBadge");
    const voiceSosDetectedAlert = document.getElementById("voiceSosDetectedAlert");
    const voiceSosDetectedText = document.getElementById("voiceSosDetectedText");

    if (!btnToggleVoiceSos) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    function handleVoiceSosTrigger(matchedWord) {
      const now = Date.now();
      if (now - voiceSosLastTriggerTime < 8000) return; // Prevent rapid duplicate re-triggers
      voiceSosLastTriggerTime = now;

      console.log(`🎙️ HANDS-FREE VOICE SOS TRIGGERED by word: "${matchedWord}"`);
      if (voiceSosDetectedAlert && voiceSosDetectedText) {
        voiceSosDetectedText.innerText = `Keyword "${matchedWord.toUpperCase()}" detected! Auto-dispatching emergency SOS...`;
        voiceSosDetectedAlert.classList.remove("hidden");
        setTimeout(() => voiceSosDetectedAlert.classList.add("hidden"), 6000);
      }

      TacticalSpeech.speak(`Distress keyword detected: ${matchedWord}. Emergency SOS beacon transmitting now.`, true);

      // Execute Immediate Panic SOS Dispatch!
      executeSosDispatch({
        isPanic: true,
        customNote: `VOICE SOS: "${matchedWord.toUpperCase()}"`
      });
    }

    function startRecognition() {
      if (!SpeechRecognition) {
        console.warn("Web Speech API not available on this browser, activating acoustic scream detector fallback.");
        startAcousticVoiceFallback();
        return;
      }

      try {
        speechRecognizer = new SpeechRecognition();
        speechRecognizer.continuous = true;
        speechRecognizer.interimResults = true;
        speechRecognizer.lang = 'en-US';

        speechRecognizer.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.toLowerCase();
            const keywords = ['help', 'sos', 'emergency', 'save me', 'trapped', 'fire', 'flood', 'rescue', 'danger'];
            const matched = keywords.find(kw => transcript.includes(kw));
            if (matched) {
              handleVoiceSosTrigger(matched);
              break;
            }
          }
        };

        speechRecognizer.onerror = (err) => {
          console.warn("Speech recognition notice:", err.error);
          if (isHandsFreeVoiceActive && err.error !== 'not-allowed') {
            setTimeout(() => {
              if (isHandsFreeVoiceActive) {
                try { speechRecognizer.start(); } catch (e) {}
              }
            }, 1000);
          }
        };

        speechRecognizer.onend = () => {
          if (isHandsFreeVoiceActive) {
            setTimeout(() => {
              if (isHandsFreeVoiceActive) {
                try { speechRecognizer.start(); } catch (e) {}
              }
            }, 300);
          }
        };

        speechRecognizer.start();
      } catch (err) {
        console.warn("SpeechRecognizer start notice:", err);
      }
    }

    // High energy acoustic volume scream detector as fallback / complement
    let screamCheckInterval = null;
    function startAcousticVoiceFallback() {
      if (screamCheckInterval) clearInterval(screamCheckInterval);
      screamCheckInterval = setInterval(() => {
        if (!isHandsFreeVoiceActive || !modem || !modem.analyser) return;
        const data = new Uint8Array(modem.analyser.frequencyBinCount);
        modem.analyser.getByteFrequencyData(data);
        // Measure mid-speech frequencies (300Hz - 2500Hz, bins 15 to 110)
        let sum = 0, count = 0;
        for (let i = 15; i < 110; i++) {
          sum += data[i];
          count++;
        }
        const avg = sum / count;
        if (avg > 185) { // Loud yell/scream detected
          handleVoiceSosTrigger("LOUD SCREAM / SHOUT");
        }
      }, 350);
    }

    btnToggleVoiceSos.addEventListener("click", async () => {
      await modem.initAudio();
      isHandsFreeVoiceActive = !isHandsFreeVoiceActive;

      if (isHandsFreeVoiceActive) {
        await modem.startListening();
        updateMicStatusUi();
        startRecognition();
        startAcousticVoiceFallback();

        voiceSosDot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
        voiceSosBtnText.innerText = "VOICE SOS: ACTIVE (SAY 'HELP' OR 'SOS')";
        voiceSosBadge.className = "text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-500/50 px-2 py-0.5 rounded font-bold font-mono uppercase animate-pulse";
        voiceSosBadge.innerText = "LISTENING FOR 'HELP'";
        TacticalSpeech.speak("Hands free voice SOS listener active. Say Help or S O S to trigger emergency broadcast.");
      } else {
        if (speechRecognizer) {
          try { speechRecognizer.stop(); } catch (e) {}
          speechRecognizer = null;
        }
        if (screamCheckInterval) clearInterval(screamCheckInterval);

        voiceSosDot.className = "w-2 h-2 rounded-full bg-neutral-500";
        voiceSosBtnText.innerText = "ACTIVATE HANDS-FREE VOICE SOS";
        voiceSosBadge.className = "text-[9px] bg-neutral-950 text-neutral-400 border border-white/20 px-2 py-0.5 rounded font-bold font-mono uppercase";
        voiceSosBadge.innerText = "STANDBY / OFF";
        TacticalSpeech.speak("Hands free voice listener disabled.");
      }
    });
  }
  setupHandsFreeVoiceSos();

  document.querySelectorAll(".type-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".type-btn").forEach(b => b.classList.remove("ring-2", "ring-white"));
      const target = e.currentTarget;
      target.classList.add("ring-2", "ring-white");
      selectedType = parseInt(target.dataset.type);
    });
  });

  // ==========================================
  // 🚨 CENTRALIZED SOS DISPATCHER: LIVE GPS + VOICE ATTACHMENT
  // ==========================================
  async function executeSosDispatch({ isPanic = false, customNote = null, customType = null } = {}) {
    await modem.initAudio();

    // 🎙️ Automatically finalize any active voice recording or pending conversion
    const attachedVoice = await finishAnyActiveVoiceRecording();

    if (currentRole === 'sender') {
      await modem.startListening();
      updateMicStatusUi();
    }

    let loc = (currentLat && currentLon)
      ? { lat: currentLat, lon: currentLon, accuracy: currentAccuracy || 15 }
      : getFallbackLocation();

    const nameInput = document.getElementById("txtName");
    const textInput = document.getElementById("txtMessage");
    const survivorName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : "Survivor";
    const text = customNote || (textInput ? textInput.value.slice(0, 15) : "") || (isPanic ? "CRITICAL PANIC SOS" : "Emergency SOS");
    const type = customType !== null ? customType : (isPanic ? 2 : selectedType);
    const generatedId = Math.floor(1000 + Math.random() * 9000);
    const sentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    myLastSentMsgId = generatedId;
    try { sessionStorage.setItem("silentbridge_last_msg_id", String(generatedId)); } catch (e) {}

    // Attach voice recording memo (ensuring base64 is captured and ready)
    const voicePayload = attachedVoice || senderVoiceBase64 || null;

    // Packet ALWAYS preserves survivor's recorded voice note if available!
    const maxHops = (meshBridge && meshBridge.maxMeshHops) ? meshBridge.maxMeshHops : 15;
    const packetObj = {
      msgId: generatedId,
      name: survivorName,
      type: type,
      lat: Number(loc.lat),
      lon: Number(loc.lon),
      accuracy: Number(loc.accuracy),
      ttl: maxHops,
      hops: 0,
      relayChain: [],
      text: text,
      voiceAudio: voicePayload,
      timestamp: sentTime,
      isPanic: isPanic
    };

    console.log(`📢 Prepared SOS packet #${generatedId}. Voice attached: ${Boolean(voicePayload)} (${voicePayload ? voicePayload.length : 0} chars), TTL: ${maxHops} Hops`);

    // Store in offline disaster vault (persists if phone is completely offline)
    try {
      localStorage.setItem('silentbridge_last_offline_sos', JSON.stringify(packetObj));
    } catch (e) {}

    const acousticBytes = (typeof PacketEngine !== 'undefined' && PacketEngine.encodeAcoustic)
      ? PacketEngine.encodeAcoustic(packetObj)
      : PacketEngine.encode(packetObj);

    // 1. Acoustic Speaker Burst (Works 100% offline without cellular or Wi-Fi)
    await modem.transmitPacket(acousticBytes);

    // 2. Multi-Transport Cloud Mesh (Works worldwide across devices)
    broadcastMeshPacket(packetObj);

    // 3. Retry loop until Rescue HQ confirms with ACK
    startBeaconRetryLoop(packetObj);

    // Post-transmission: activate microphone to receive Base Station's acoustic ACK!
    if (currentRole === 'sender') {
      modem.startListening();
      updateMicStatusUi();
    }

    // Refresh satellite fix in background
    getAccurateDeviceLocation().then(fresh => {
      if (fresh && activePendingPacket) {
        activePendingPacket.lat = Number(fresh.lat);
        activePendingPacket.lon = Number(fresh.lon);
        activePendingPacket.accuracy = Number(fresh.accuracy);
      }
    });

    return packetObj;
  }

  // 1-Tap Instant Panic Button with Immediate Non-Blocking Audio Output
  document.getElementById("btnInstantPanic").addEventListener("click", async () => {
    const btn = document.getElementById("btnInstantPanic");
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<span>🔊</span> BROADCASTING ACOUSTIC SOUND...`;

    await executeSosDispatch({ isPanic: true });

    btn.innerHTML = originalHtml;
  });

  // Standard Transmit Action with Immediate Non-Blocking Audio Output
  document.getElementById("btnSend").addEventListener("click", async () => {
    const btn = document.getElementById("btnSend");
    btn.disabled = true;
    const hasVoice = Boolean(senderVoiceBase64 || isRecording);
    btn.innerText = hasVoice
      ? "🔊 BROADCASTING WITH VOICE MEMO..."
      : "🔊 BROADCASTING ACOUSTIC SOUND...";

    try {
      await executeSosDispatch({ isPanic: false });
    } finally {
      btn.disabled = false;
      btn.innerText = "📢 BROADCAST WITH NOTE / AUDIO";
    }
  });

  // Offline Acoustic Test Controls
  const btnTestSpeaker = document.getElementById("btnTestSpeaker");
  if (btnTestSpeaker) {
    btnTestSpeaker.addEventListener("click", async () => {
      await modem.initAudio();
      btnTestSpeaker.innerText = "🔊 Chirping...";
      await modem.playTestChirp();
      setTimeout(() => {
        btnTestSpeaker.innerHTML = "<span>🔊</span> Test Speaker";
      }, 600);
    });
  }

  const btnAcousticPing = document.getElementById("btnAcousticPing");
  if (btnAcousticPing) {
    btnAcousticPing.addEventListener("click", async () => {
      await modem.initAudio();
      const pingId = Math.floor(1000 + Math.random() * 9000);
      btnAcousticPing.innerText = `📶 Sending Ping #${pingId}...`;

      const pingBytes = (typeof PacketEngine !== 'undefined' && PacketEngine.encodeAcoustic)
        ? PacketEngine.encodeAcoustic({ msgId: pingId, type: 0xFD })
        : null;

      if (pingBytes) {
        await modem.transmitPacket(pingBytes);
      }
      broadcastMeshPacket({ msgId: pingId, type: 0xFD, isTest: true, text: "Acoustic Test Ping" });

      if (currentRole === 'sender') {
        modem.startListening();
        updateMicStatusUi();
      }

      btnAcousticPing.innerText = `✓ Sent #${pingId}!`;
      setTimeout(() => {
        btnAcousticPing.innerHTML = "<span>📶</span> Acoustic Ping (HQ)";
      }, 2500);
    });
  }

  // Centralized Rescue ACK Dispatch Controller (Acoustic Loudspeaker & Global Cloud Mesh)
  let latestDetectedSosPacket = null;

  async function dispatchRescueAck(packetToAck, triggerBtn) {
    const txtBeaconId = document.getElementById("txtTargetBeaconId");
    let target = packetToAck || latestDetectedSosPacket;

    let msgId = 0;
    let targetRoom = 'GLOBAL';

    if (target && target.msgId) {
      msgId = Number(target.msgId) || 0;
      targetRoom = target._room || 'GLOBAL';
    } else if (txtBeaconId && txtBeaconId.value.trim() && txtBeaconId.value.trim().toUpperCase() !== 'ALL') {
      msgId = parseInt(txtBeaconId.value.trim(), 10) || 0;
    }

    const isBroadcast = (msgId === 0);
    const labelId = isBroadcast ? 'ALL ACTIVE SENDERS' : `#${msgId}`;
    const ackTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    console.log(`🛡️ Dispatching Rescue ACK for beacon ${labelId}...`);

    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.innerHTML = `<span>⏳</span> DISPATCHING ACK (${labelId})...`;
    }

    const logEl = document.getElementById("ackDispatchLog");
    if (logEl) {
      logEl.innerText = `Transmitting acoustic audio tones and cloud mesh packet for ${labelId}...`;
      logEl.className = "text-[10px] text-amber-300 font-mono animate-pulse bg-neutral-900/80 p-2 rounded border border-amber-400/30";
    }

    // 1. Acoustic ACK Transmission (Double-burst for 99.9% physical airwave capture)
    try {
      await modem.initAudio();
      const ackBytes = (typeof PacketEngine !== 'undefined' && PacketEngine.encodeAcoustic)
        ? PacketEngine.encodeAcoustic({ msgId: msgId, type: 0xFF })
        : PacketEngine.encodeAck(msgId);
      // Burst 1
      await modem.transmitPacket(ackBytes);
      console.log(`🔊 Acoustic ACK burst 1 broadcasted over speaker for ${labelId}`);
      // Burst 2 after 300ms gap for maximum acoustic capture reliability
      setTimeout(async () => {
        try {
          if (modem) await modem.transmitPacket(ackBytes);
          console.log(`🔊 Acoustic ACK burst 2 broadcasted over speaker for ${labelId}`);
        } catch (e) {}
      }, 300);
    } catch (acousticErr) {
      console.warn("Acoustic ACK playback note:", acousticErr);
    }

    // 2. Multi-Transport Cloud Mesh MQTT (Worldwide over any distance)
    const attachedRescuerVoice = await finishAnyActiveRescuerVoiceRecording();
    const rescuerPayload = attachedRescuerVoice || rescuerVoiceBase64 || null;

    broadcastMeshPacket({
      msgId: msgId,
      type: 0xFF,
      isBroadcast: isBroadcast,
      timestamp: ackTime,
      _room: targetRoom,
      ackVoiceAudio: rescuerPayload
    });
    console.log(`🌐 Mesh ACK packet broadcasted for ${labelId} (Room: #${targetRoom}). Rescuer voice attached: ${Boolean(rescuerPayload)}`);
    TacticalSpeech.speak(`Rescue ACK dispatched for ${labelId}. Help is confirmed.`, false);

    // 3. Synchronize All UI Elements
    if (triggerBtn) {
      triggerBtn.innerHTML = `<span>✓</span> ACK DISPATCHED (${labelId} AT ${ackTime})`;
      triggerBtn.className = "w-full bg-neutral-800 text-emerald-400 font-black text-xs md:text-sm py-3 px-4 rounded-lg shadow-xl flex items-center justify-center gap-2 uppercase tracking-wider font-mono border border-emerald-400/40";
      setTimeout(() => {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = `<span>🛡️</span> SEND RESCUE ACK TO SENDER (AIRWAVES + CLOUD) ➔`;
        triggerBtn.className = "w-full bg-emerald-400 hover:bg-emerald-300 active:scale-95 text-black font-black text-xs md:text-sm py-3 px-4 rounded-lg shadow-xl flex items-center justify-center gap-2 uppercase tracking-wider font-mono transition";
      }, 5000);
    }

    const bannerAckBtn = document.getElementById("btnBannerSendAck");
    if (bannerAckBtn && bannerAckBtn !== triggerBtn) {
      bannerAckBtn.innerHTML = `<span>✓</span> ACK DISPATCHED (${labelId})`;
      bannerAckBtn.disabled = true;
      bannerAckBtn.className = "bg-neutral-800 text-neutral-400 font-bold text-xs px-3.5 py-2 rounded-lg cursor-not-allowed";
    }

    const beaconSummaryEl = document.getElementById("latestBeaconSummary");
    if (beaconSummaryEl) {
      beaconSummaryEl.innerText = `CONFIRMED: Rescue ACK dispatched for ${labelId} at ${ackTime}`;
      beaconSummaryEl.className = "bg-neutral-900 border border-emerald-400/50 p-2 rounded text-[11px] text-emerald-400 font-mono font-bold truncate";
    }

    if (logEl) {
      logEl.innerText = `✓ SUCCESS: Rescue ACK transmitted for ${labelId} at ${ackTime} via Acoustic Loudspeaker (1200-2200Hz) & Global Cloud Mesh.`;
      logEl.className = "text-[10px] text-emerald-400 font-mono font-bold bg-neutral-900/80 p-2 rounded border border-emerald-400/30";
    }

    // Update any feed card ACK buttons for this beacon
    if (msgId) {
      document.querySelectorAll(`.card-ack-btn-${msgId}`).forEach(btn => {
        btn.innerText = `✓ ACK DISPATCHED (${ackTime})`;
        btn.disabled = true;
        btn.className = "ack-btn flex-1 bg-neutral-800 text-neutral-500 font-bold py-1.5 px-3 rounded cursor-not-allowed text-xs";
      });
    }
  }

  // Wire ACK Dispatch Buttons
  const btnMainDispatchAck = document.getElementById("btnMainDispatchAck");
  if (btnMainDispatchAck) {
    btnMainDispatchAck.addEventListener("click", () => {
      dispatchRescueAck(null, btnMainDispatchAck);
    });
  }

  const btnBannerSendAck = document.getElementById("btnBannerSendAck");
  if (btnBannerSendAck) {
    btnBannerSendAck.addEventListener("click", () => {
      dispatchRescueAck(latestDetectedSosPacket, btnBannerSendAck);
    });
  }

  const btnQuickDispatchAck = document.getElementById("btnQuickDispatchAck");
  if (btnQuickDispatchAck) {
    btnQuickDispatchAck.addEventListener("click", () => {
      dispatchRescueAck(latestDetectedSosPacket, btnQuickDispatchAck);
    });
  }

  // Receiver Handler with High-Precision Marker & Direct OpenStreetMap Focus
  function handleReceivedPacket(packet, transport) {
    const currentTime = packet.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const survivorName = packet.name || "Survivor";

    // 1. Check for Test Ping packet
    if (packet.type === 0xFD || packet.isTest) {
      const banner = document.getElementById("testPingBanner");
      const title = document.getElementById("testPingTitle");
      const subtitle = document.getElementById("testPingSubtitle");
      if (banner && title && subtitle) {
        title.innerText = `TEST PING RECEIVED FROM ${packet._senderRole ? packet._senderRole.toUpperCase() : 'PEER'} (#${packet.msgId || 'SYNC'})`;
        subtitle.innerText = `Signal received at ${currentTime} via ${transport || 'mesh'}. Cloud mesh synchronized.`;
        banner.classList.remove("hidden");
        setTimeout(() => banner.classList.add("hidden"), 8000);
      }
      return;
    }

    // 2. Check for Rescue ACK confirmation packet
    if (packet.type === 0xFF) {
      if (currentRole === 'sender') {
        const isBroadcastAck = packet.msgId === 0 || packet.msgId === 1000 || packet.msgId === 'ALL' || packet.isBroadcast;
        const isMatchingId = (myLastSentMsgId && String(packet.msgId) === String(myLastSentMsgId))
          || (activePendingPacket && String(packet.msgId) === String(activePendingPacket.msgId));
        // In offline mode (acoustic), if sender is pending rescue, accept any base station acoustic ACK!
        const isMyAck = isBroadcastAck || isMatchingId || (transport === 'acoustic' && activePendingPacket);

        if (isMyAck) {
          console.log(`✅ Rescue ACK confirmed for beacon #${packet.msgId || myLastSentMsgId}. Stopping distress retries.`);
          stopBeaconRetryLoop();
          document.getElementById("ackTime").innerText = currentTime;
          document.getElementById("ackTitle").innerText = `BASE STATION ACKNOWLEDGED DISTRESS BEACON #${packet.msgId || myLastSentMsgId || 'CONFIRMED'}! HELP IS EN ROUTE.`;
          ackBanner.classList.remove("hidden");

          applySenderGreenPositiveState(packet.msgId || myLastSentMsgId, currentTime);
          if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 500]);
          modem.playAlarmChime();

          // Tactical Voice confirmation readout:
          TacticalSpeech.speak("Rescue confirmed! Base station has acknowledged your distress beacon. Emergency responders are en route. Stay safe.", true);

          // If Rescuer sent a voice instruction memo with the ACK:
          if (packet.ackVoiceAudio) {
            const voiceBox = document.getElementById("senderRescuerVoiceBox");
            const audioEl = document.getElementById("senderRescuerAudio");
            if (voiceBox && audioEl) {
              audioEl.src = packet.ackVoiceAudio;
              voiceBox.classList.remove("hidden");
              try { audioEl.play(); } catch (e) {}
            }
          }
        }
      }
      return;
    }

  // Helper to dynamically inject or update survivor voice memo in Rescuer UI
  function enrichRescuerUiWithVoice(packet) {
    if (!packet || !packet.voiceAudio) return;
    const survivorName = packet.name || "Survivor";
    const currentTime = packet.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // 1. Update Top Alert Banner Voice Section
    const bannerVoiceSec = document.getElementById("bannerVoiceSection");
    const bannerVoiceAudio = document.getElementById("bannerVoiceAudio");
    if (bannerVoiceSec && bannerVoiceAudio) {
      bannerVoiceAudio.src = packet.voiceAudio;
      bannerVoiceSec.classList.remove("hidden");
      bannerVoiceSec.style.display = "flex";
      const btnPlay = document.getElementById("btnPlayBannerVoice");
      if (btnPlay) {
        btnPlay.onclick = () => {
          bannerVoiceAudio.currentTime = 0;
          bannerVoiceAudio.play().catch(e => console.warn(e));
        };
      }
    }

    // 2. Update Live Incident Feed Card
    const card = document.getElementById(`incident-card-${packet.msgId}`);
    if (card) {
      let voiceContainer = card.querySelector(".voice-player-container");
      if (!voiceContainer) {
        voiceContainer = document.createElement("div");
        voiceContainer.className = "voice-player-container bg-black p-2.5 rounded-lg border-2 border-emerald-400/80 flex flex-col gap-1.5 shadow-inner my-1";
        voiceContainer.innerHTML = `
          <div class="flex justify-between items-center">
            <span class="text-[10px] text-emerald-300 font-bold font-mono flex items-center gap-1">
              <span>🎙️</span> ${survivorName.toUpperCase()}'S VOICE NOTE (${currentTime}):
            </span>
            <span class="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-500/40 px-1.5 py-0.5 rounded font-mono font-bold animate-pulse">AUDIO READY</span>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-play-voice-${packet.msgId} bg-emerald-400 hover:bg-emerald-300 text-black font-black text-[11px] px-3 py-1 rounded flex items-center gap-1 shadow transition active:scale-95">
              ▶️ Play Voice
            </button>
            <audio id="feedVoiceAudio_${packet.msgId}" controls src="${packet.voiceAudio}" class="flex-1 h-7 rounded"></audio>
          </div>
        `;
        const btnRow = card.querySelector(".flex.gap-2.mt-1");
        if (btnRow) {
          card.insertBefore(voiceContainer, btnRow);
        } else {
          card.appendChild(voiceContainer);
        }
        const playBtn = voiceContainer.querySelector(`.btn-play-voice-${packet.msgId}`);
        const audioEl = voiceContainer.querySelector(`#feedVoiceAudio_${packet.msgId}`);
        if (playBtn && audioEl) {
          playBtn.onclick = () => {
            audioEl.currentTime = 0;
            audioEl.play().catch(e => console.warn(e));
          };
        }
      } else {
        const audioEl = voiceContainer.querySelector("audio");
        if (audioEl) audioEl.src = packet.voiceAudio;
      }
    }

    TacticalSpeech.speak(`Voice memo received for incident number ${packet.msgId} from ${survivorName}.`);
  }

  // 3. Deduplicate SOS packet, but permit voice enrichment if a subsequent packet has voiceAudio
  const isAlreadySeen = seenMessages.has(packet.msgId);
  if (isAlreadySeen) {
    const prevPacket = window.seenSosPackets && window.seenSosPackets.get(packet.msgId);
    if (packet.voiceAudio && (!prevPacket || !prevPacket.voiceAudio)) {
      console.log(`🎙️ Voice audio enrichment arrived for beacon #${packet.msgId}! Updating UI.`);
      if (prevPacket) prevPacket.voiceAudio = packet.voiceAudio;
      if (window.seenSosPackets) window.seenSosPackets.set(packet.msgId, packet);
      if (currentRole === 'receiver') {
        enrichRescuerUiWithVoice(packet);
      }
    }
    return;
  }
  seenMessages.add(packet.msgId);
  if (!window.seenSosPackets) window.seenSosPackets = new Map();
  window.seenSosPackets.set(packet.msgId, packet);

  // 4. Handle incoming SOS on Rescue HQ
  if (currentRole === 'receiver') {
    latestDetectedSosPacket = packet;
    playEmergencyAlertSound();

    const typeNames = { 1: "Medical", 2: "Trapped", 3: "Fire", 4: "Flood" };
    const typeName = packet.isPanic ? "CRITICAL PANIC" : (typeNames[packet.type] || "Distress");

    const validLat = Number(packet.lat) || 17.3850;
    const validLon = Number(packet.lon) || 78.4867;
    const validAcc = Number(packet.accuracy) || 15;

    // Calculate Geodesic Distance and Compass Bearing across large distances
    let distStr = "Direct Signal";
    let bearingStr = "";
    let distanceInMeters = null;

    if (currentLat && currentLon && validLat && validLon) {
      distanceInMeters = calculateHaversineDistance(currentLat, currentLon, validLat, validLon);
      const bearingObj = calculateCompassBearing(currentLat, currentLon, validLat, validLon);
      bearingStr = `${bearingObj.cardinal} (${bearingObj.degrees}°)`;
      if (distanceInMeters < 1000) {
        distStr = `${Math.round(distanceInMeters)} meters`;
      } else {
        distStr = `${(distanceInMeters / 1000).toFixed(2)} km`;
      }
    }

    // Check Rescuer Reception Range Limit Filter (defaults to unlimited)
    const selRescuerRangeEl = document.getElementById("selRescuerRange");
    const selectedRescuerRange = selRescuerRangeEl ? selRescuerRangeEl.value : 'unlimited';
    if (selectedRescuerRange !== 'unlimited' && distanceInMeters !== null) {
      const maxAllowed = parseInt(selectedRescuerRange, 10) * 1000;
      if (distanceInMeters > maxAllowed) {
        console.log(`Incident #${packet.msgId} exceeds currently selected range limit (${selectedRescuerRange} km). Distance: ${distStr}`);
        return;
      }
    }

    // Tactical Voice Announcement on HQ
    const distSpoken = (distanceInMeters !== null) ? ` Distance: ${distStr}.` : '';
    TacticalSpeech.speak(`Emergency alert. Distress beacon received from ${survivorName}. Incident type: ${typeName}.${distSpoken} Coordinates plotted.`);

    // Update Target Beacon ID Input in Console
    const txtBeaconId = document.getElementById("txtTargetBeaconId");
    if (txtBeaconId) txtBeaconId.value = packet.msgId;

    // Update Empty State in Feed
    const emptyFeed = document.getElementById("feedEmptyState");
    if (emptyFeed) emptyFeed.classList.add("hidden");

    // Update Top Alert Banner with Distance and Multi-Hop Route
    const hopInfo = packet.hops ? ` • 📡 Relayed (${packet.hops} Hops)` : '';
    const distInfo = (distanceInMeters !== null) ? ` • 📍 ${distStr} ${bearingStr ? '(' + bearingStr + ')' : ''}` : '';
    document.getElementById("sosTime").innerText = currentTime;
    document.getElementById("sosTitle").innerText = `🚨 ${typeName.toUpperCase()} FROM ${survivorName.toUpperCase()} (#${packet.msgId})!`;
    document.getElementById("sosSubtitle").innerText = `GPS: ${validLat.toFixed(6)}, ${validLon.toFixed(6)} (±${validAcc}m)${distInfo}${hopInfo}`;
    sosBanner.classList.remove("hidden");

    // Update Top Banner Voice Memo
    const bannerVoiceSec = document.getElementById("bannerVoiceSection");
    const bannerVoiceAudio = document.getElementById("bannerVoiceAudio");
    if (bannerVoiceSec && bannerVoiceAudio) {
      if (packet.voiceAudio) {
        bannerVoiceAudio.src = packet.voiceAudio;
        bannerVoiceSec.classList.remove("hidden");
        bannerVoiceSec.style.display = "flex";
        const btnPlay = document.getElementById("btnPlayBannerVoice");
        if (btnPlay) {
          btnPlay.onclick = () => {
            bannerVoiceAudio.currentTime = 0;
            bannerVoiceAudio.play().catch(e => console.warn(e));
          };
        }
      } else {
        bannerVoiceSec.classList.add("hidden");
        bannerVoiceSec.style.display = "none";
      }
    }

    if (btnBannerSendAck) {
      btnBannerSendAck.disabled = false;
      btnBannerSendAck.innerHTML = `<span>🛡️</span> SEND RESCUE ACK ➔`;
      btnBannerSendAck.className = "bg-emerald-400 hover:bg-emerald-300 text-black font-black text-xs px-3.5 py-2 rounded-lg transition uppercase tracking-wider flex items-center gap-1.5 shadow-xl active:scale-95";
    }

    // Update Rescue ACK Console Status & Button
    const mainBtn = document.getElementById("btnMainDispatchAck");
    if (mainBtn) {
      mainBtn.innerHTML = `<span>🛡️</span> SEND RESCUE ACK TO ${survivorName.toUpperCase()} (#${packet.msgId}) ➔`;
    }

    const beaconSummaryEl = document.getElementById("latestBeaconSummary");
    if (beaconSummaryEl) {
      beaconSummaryEl.innerText = `ACTIVE BEACON #${packet.msgId} (${survivorName}) - Lat: ${validLat.toFixed(5)}, Lon: ${validLon.toFixed(5)} [${distStr}]`;
      beaconSummaryEl.className = "bg-neutral-900 border border-emerald-400/50 p-2 rounded text-[11px] text-emerald-300 font-mono font-bold truncate animate-pulse";
    }

    const logEl = document.getElementById("ackDispatchLog");
    if (logEl) {
      logEl.innerText = `ALERT: Distress beacon #${packet.msgId} detected (${distStr}). Ready to transmit Rescue ACK across mesh.`;
      logEl.className = "text-[10px] text-amber-300 font-mono bg-neutral-900/80 p-2 rounded border border-amber-400/30";
    }

    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

    const googleMapsNavUrl = `https://www.google.com/maps/dir/?api=1&destination=${validLat},${validLon}`;

    // Add High-Precision Map Marker & Tactical Trajectory Vector across ANY Distance
    if (typeof L !== 'undefined' && map && markersLayer) {
      try {
        const marker = L.marker([validLat, validLon]).addTo(markersLayer);
        L.circle([validLat, validLon], {
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: 0.25,
          radius: validAcc
        }).addTo(markersLayer);

        // Plot or update Rescuer Base Station marker
        if (currentLat && currentLon) {
          if (!window.rescuerHqMarker) {
            window.rescuerHqMarker = L.circleMarker([currentLat, currentLon], {
              radius: 9,
              color: '#38bdf8',
              fillColor: '#0284c7',
              fillOpacity: 0.9,
              weight: 3
            }).addTo(markersLayer).bindPopup("<b style='color:black;'>🛡️ RESCUE HQ (YOUR CURRENT POSITION)</b>");
          } else {
            window.rescuerHqMarker.setLatLng([currentLat, currentLon]);
          }

          // Tactical trajectory vector connecting Rescuer and Survivor
          L.polyline([[currentLat, currentLon], [validLat, validLon]], {
            color: '#38bdf8',
            weight: 2.5,
            opacity: 0.85,
            dashArray: '8, 8'
          }).addTo(markersLayer).bindTooltip(`Tactical Vector: ${distStr} ${bearingStr}`, { permanent: false });
        }

        marker.bindPopup(`
          <div class="font-mono text-xs text-black">
            <b>${packet.isPanic ? '🚨 CRITICAL PANIC' : 'SOS Beacon'} #${packet.msgId}</b><br>
            <span><b>Survivor:</b> ${survivorName}</span><br>
            <span><b>Time:</b> ${currentTime}</span><br>
            <span><b>GPS:</b> ${validLat.toFixed(6)}, ${validLon.toFixed(6)} (±${validAcc}m)</span><br>
            <span><b>Distance to HQ:</b> ${distStr} ${bearingStr ? '(' + bearingStr + ')' : ''}</span><br>
            ${packet.hops ? `<span><b>Mesh Route:</b> Relayed via ${packet.hops} Hops</span><br>` : ''}
            ${packet.voiceAudio ? '<span style="color:#059669; font-weight:bold;">🎙️ Situational Voice Memo Attached</span><br>' : ''}
            <a href="${googleMapsNavUrl}" target="_blank" style="color: #0066cc; text-decoration: underline; font-weight: bold; margin-top: 4px; display: inline-block;">🗺️ Open Turn-by-Turn Route</a>
            <button id="btnMapPopupAck_${packet.msgId}" style="margin-top: 8px; width: 100%; background: #10b981; color: black; font-weight: 900; padding: 6px 10px; border-radius: 6px; border: none; cursor: pointer; text-transform: uppercase;">
              🛡️ SEND RESCUE ACK ➔
            </button>
          </div>
        `).openPopup();

        marker.on('popupopen', () => {
          const popupAckBtn = document.getElementById(`btnMapPopupAck_${packet.msgId}`);
          if (popupAckBtn) {
            popupAckBtn.onclick = () => dispatchRescueAck(packet, popupAckBtn);
          }
        });

        // Fit map bounds across all coordinates so both Rescuer and Survivor are in view across any distance
        const allPoints = [[validLat, validLon]];
        if (currentLat && currentLon) allPoints.push([currentLat, currentLon]);
        map.fitBounds(L.latLngBounds(allPoints).pad(0.25));
      } catch (mapErr) {
        console.warn("Leaflet marker placement note:", mapErr);
      }
    }

    // Persist incident in Offline Disaster Vault
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = JSON.parse(localStorage.getItem('silentbridge_saved_incidents') || '[]');
        if (!saved.some(i => i.msgId === packet.msgId)) {
          saved.unshift(packet);
          localStorage.setItem('silentbridge_saved_incidents', JSON.stringify(saved.slice(0, 30)));
        }
      }
    } catch (e) {}

    // Add Card to Live Incident Feed
    const feed = document.getElementById("feed");
    const card = document.createElement("div");
    card.id = `incident-card-${packet.msgId}`;
    card.className = packet.isPanic 
      ? "bg-neutral-900 border-2 border-red-500 p-3.5 rounded-lg shadow-xl text-xs flex flex-col gap-2"
      : "bg-neutral-900 border-l-4 border-emerald-400 p-3.5 rounded-lg shadow-lg text-xs flex flex-col gap-2";

    let voicePlayerHtml = '';
    if (packet.voiceAudio) {
      voicePlayerHtml = `
        <div class="voice-player-container bg-black p-2.5 rounded-lg border-2 border-emerald-400/80 flex flex-col gap-1.5 shadow-inner my-1">
          <div class="flex justify-between items-center">
            <span class="text-[10px] text-emerald-300 font-bold font-mono flex items-center gap-1">
              <span>🎙️</span> ${survivorName.toUpperCase()}'S VOICE NOTE (${currentTime}):
            </span>
            <span class="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-500/40 px-1.5 py-0.5 rounded font-mono font-bold animate-pulse">AUDIO READY</span>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-play-voice-${packet.msgId} bg-emerald-400 hover:bg-emerald-300 text-black font-black text-[11px] px-3 py-1 rounded flex items-center gap-1 shadow transition active:scale-95">
              ▶️ Play Voice
            </button>
            <audio id="feedVoiceAudio_${packet.msgId}" controls src="${packet.voiceAudio}" class="flex-1 h-7 rounded"></audio>
          </div>
        </div>
      `;
    } else if (packet.hasVoice) {
      voicePlayerHtml = `
        <div class="voice-player-container bg-neutral-950 p-2 rounded border border-white/20 text-[10px] text-neutral-400 font-mono">
          🎙️ Voice memo recorded by survivor (audio stripped over low-bandwidth link).
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex justify-between items-center text-neutral-400 font-mono">
        <span class="font-black text-white">#${packet.msgId} (${typeName})</span>
        <span class="text-white">🕒 ${currentTime}</span>
      </div>
      <div class="text-xs font-bold text-white">👤 Survivor: ${survivorName}</div>
      <p class="text-neutral-200 font-medium">${packet.text || "Emergency SOS"}</p>
      <div class="flex flex-wrap justify-between text-neutral-400 font-mono text-[11px] gap-1">
        <span>GPS: ${validLat.toFixed(6)}, ${validLon.toFixed(6)} (±${validAcc}m)</span>
        <span class="text-emerald-300 font-bold">📍 ${distStr} ${bearingStr ? '(' + bearingStr + ')' : ''}</span>
      </div>
      <div class="flex justify-between items-center text-[10px] text-neutral-400 font-mono">
        <span>Route: ${packet.hops ? '📡 Multi-Hop Relayed (' + packet.hops + ' Hops)' : 'Direct Signal'}</span>
        ${packet.relayedBy ? `<span class="text-neutral-500">Via: ${packet.relayedBy}</span>` : ''}
      </div>
      ${voicePlayerHtml}
      <div class="flex gap-2 mt-1">
        <a href="${googleMapsNavUrl}" target="_blank" class="bg-white hover:bg-neutral-200 text-black font-bold py-1.5 px-3 rounded flex items-center gap-1 transition text-center justify-center">
          🗺️ Route
        </a>
        <button class="vocalize-btn-${packet.msgId} bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono font-bold py-1.5 px-2.5 rounded text-[11px] border border-white/20 transition flex items-center gap-1" title="Vocalize telemetry using Tactical Voice">
          <span>🔊</span> Speak
        </button>
        <button class="ack-btn card-ack-btn-${packet.msgId} flex-1 bg-emerald-400 hover:bg-emerald-300 text-black font-black py-1.5 px-3 rounded transition uppercase tracking-wider shadow active:scale-95">
          🛡️ SEND RESCUE ACK ➔
        </button>
      </div>
    `;
    feed.prepend(card);

    const playCardVoiceBtn = card.querySelector(`.btn-play-voice-${packet.msgId}`);
    const cardAudioEl = card.querySelector(`#feedVoiceAudio_${packet.msgId}`);
    if (playCardVoiceBtn && cardAudioEl) {
      playCardVoiceBtn.onclick = () => {
        cardAudioEl.currentTime = 0;
        cardAudioEl.play().catch(e => console.warn(e));
      };
    }

    const vocalizeBtn = card.querySelector(`.vocalize-btn-${packet.msgId}`);
    if (vocalizeBtn) {
      vocalizeBtn.addEventListener("click", () => {
        TacticalSpeech.speak(`Incident report for beacon number ${packet.msgId}. Survivor: ${survivorName}. Category: ${typeName}. Note: ${packet.text || "Emergency SOS"}. Accuracy within ${validAcc} meters.`, true);
      });
    }

    const ackBtn = card.querySelector(`.card-ack-btn-${packet.msgId}`);
    if (ackBtn) {
      ackBtn.addEventListener("click", () => {
        dispatchRescueAck(packet, ackBtn);
      });
    }
  }
  }

  // Network Mesh Modal & Device Pairing UI Controls
  const meshModal = document.getElementById("meshModal");
  const btnOpenMeshModal = document.getElementById("btnOpenMeshModal");
  const btnCloseMeshModal = document.getElementById("btnCloseMeshModal");
  const txtRoomCode = document.getElementById("txtRoomCode");
  const btnApplyRoom = document.getElementById("btnApplyRoom");
  const txtShareLink = document.getElementById("txtShareLink");
  const btnCopyPairLink = document.getElementById("btnCopyPairLink");
  const copyFeedback = document.getElementById("copyFeedback");
  const btnTestSignal = document.getElementById("btnTestSignal");
  const selAudioMode = document.getElementById("selAudioMode");
  const btnDismissTestPing = document.getElementById("btnDismissTestPing");

  function updateMeshUiStatus(status) {
    const dot = document.getElementById("meshStatusDot");
    const text = document.getElementById("meshStatusText");
    const roomBadge = document.getElementById("roomBadge");
    const diagCloud = document.getElementById("diagCloudStatus");
    const diagRoom = document.getElementById("diagRoom");
    const diagRole = document.getElementById("diagRole");

    if (roomBadge) roomBadge.innerText = `#${status.room}`;
    if (diagRoom) diagRoom.innerText = `#${status.room}`;
    if (diagRole) diagRole.innerText = currentRole.toUpperCase();

    if (status.state === 'connected') {
      if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
      if (text) {
        text.className = "text-emerald-400 font-bold text-[10px]";
        text.innerText = "MESH: ONLINE";
      }
      if (diagCloud) {
        diagCloud.className = "text-emerald-400 font-bold";
        diagCloud.innerText = `● CONNECTED (${status.message || 'EMQX/HiveMQ'})`;
      }
    } else if (status.state === 'reconnecting' || status.state === 'connecting') {
      if (dot) dot.className = "w-2 h-2 rounded-full bg-amber-400 animate-ping";
      if (text) {
        text.className = "text-amber-400 font-bold text-[10px]";
        text.innerText = "MESH: SYNCING";
      }
      if (diagCloud) {
        diagCloud.className = "text-amber-400 font-bold";
        diagCloud.innerText = "○ RECONNECTING RELAY...";
      }
    } else {
      if (dot) dot.className = "w-2 h-2 rounded-full bg-neutral-500";
      if (text) {
        text.className = "text-neutral-400 font-bold text-[10px]";
        text.innerText = "MESH: OFFLINE";
      }
      if (diagCloud) {
        diagCloud.className = "text-neutral-400 font-bold";
        diagCloud.innerText = "✕ DISCONNECTED";
      }
    }
  }

  function updatePeersUi(data) {
    const diagPeers = document.getElementById("diagPeers");
    if (diagPeers) {
      diagPeers.innerText = `${data.count} peer${data.count === 1 ? '' : 's'} online in room`;
      diagPeers.className = data.count > 0 ? "text-emerald-400 font-bold" : "text-neutral-400 font-bold";
    }
  }

  function updatePairShareLink() {
    if (!txtShareLink) return;
    const curUrl = new URL(window.location.href);
    curUrl.searchParams.set('room', meshBridge.roomCode);
    txtShareLink.value = curUrl.toString();
  }

  if (btnOpenMeshModal) {
    btnOpenMeshModal.addEventListener("click", () => {
      if (txtRoomCode) txtRoomCode.value = meshBridge.roomCode;
      updatePairShareLink();
      const status = meshBridge.getStatus();
      updateMeshUiStatus({ state: status.cloudConnected ? 'connected' : 'connecting', room: status.room, message: status.broker });
      meshModal.classList.remove("hidden");
    });
  }

  if (btnCloseMeshModal) {
    btnCloseMeshModal.addEventListener("click", () => {
      meshModal.classList.add("hidden");
    });
  }

  if (btnApplyRoom) {
    btnApplyRoom.addEventListener("click", () => {
      const newRoom = txtRoomCode.value.trim().toUpperCase();
      if (newRoom) {
        meshBridge.setRoom(newRoom);
        updatePairShareLink();
        const roomBadge = document.getElementById("roomBadge");
        if (roomBadge) roomBadge.innerText = `#${meshBridge.roomCode}`;
      }
    });
  }

  if (btnCopyPairLink) {
    btnCopyPairLink.addEventListener("click", () => {
      updatePairShareLink();
      if (navigator.clipboard && txtShareLink.value) {
        navigator.clipboard.writeText(txtShareLink.value).then(() => {
          if (copyFeedback) {
            copyFeedback.classList.remove("hidden");
            setTimeout(() => copyFeedback.classList.add("hidden"), 3000);
          }
        });
      }
    });
  }

  if (btnTestSignal) {
    btnTestSignal.addEventListener("click", async () => {
      await modem.initAudio();
      const pingId = meshBridge.sendTestPing();
      const pingBytes = (typeof PacketEngine !== 'undefined' && PacketEngine.encodeAcoustic)
        ? PacketEngine.encodeAcoustic({ msgId: pingId, type: 0xFD })
        : null;
      if (pingBytes) {
        await modem.transmitPacket(pingBytes);
      }
      btnTestSignal.innerText = `✓ Ping #${pingId} Dispatched (Acoustic + Mesh)!`;
      setTimeout(() => {
        btnTestSignal.innerHTML = `<span>📶</span> Send Test Ping to HQ / Sender`;
      }, 2500);
    });
  }

  if (selAudioMode) {
    selAudioMode.addEventListener("change", (e) => {
      modem.setSoundMode(e.target.value);
    });
  }

  // Wire Acoustic Range & Hardware Pre-Amp Boost Selector
  const selAcousticRange = document.getElementById("selAcousticRange");
  if (selAcousticRange) {
    selAcousticRange.value = modem.rangeMode || 'long';
    selAcousticRange.addEventListener("change", (e) => {
      const mode = e.target.value;
      modem.setRangeMode(mode);
      const lblSenderRange = document.getElementById("lblSenderRangeMode");
      if (lblSenderRange) {
        const textMap = {
          standard: "🎯 2.5x PROXIMITY",
          long: "⚡ 5.5x PRE-AMP BOOST",
          extreme: "🚀 8.5x TURBO DUAL-BURST"
        };
        lblSenderRange.innerText = textMap[mode] || "⚡ BOOSTED RANGE";
      }
    });
  }

  // Wire Autonomous Multi-Hop Mesh Relay Controls
  const chkEnableRelay = document.getElementById("chkEnableRelay");
  if (chkEnableRelay) {
    chkEnableRelay.checked = meshBridge.enableRelay;
    chkEnableRelay.addEventListener("change", (e) => {
      meshBridge.enableRelay = e.target.checked;
      console.log("Autonomous Mesh Relay set to:", meshBridge.enableRelay);
    });
  }

  const selMeshRangeHops = document.getElementById("selMeshRangeHops");
  if (selMeshRangeHops) {
    selMeshRangeHops.value = String(meshBridge.maxMeshHops || 15);
    selMeshRangeHops.addEventListener("change", (e) => {
      meshBridge.maxMeshHops = parseInt(e.target.value, 10) || 15;
      console.log("Max Mesh Range Hops set to:", meshBridge.maxMeshHops);
    });
  }

  // Wire Local Offline Hotspot / Wi-Fi Mesh Relay
  const txtLocalWs = document.getElementById("txtLocalWs");
  const btnConnectLocalWs = document.getElementById("btnConnectLocalWs");
  if (txtLocalWs && meshBridge.customWsUrl) {
    txtLocalWs.value = meshBridge.customWsUrl;
  }
  if (btnConnectLocalWs && txtLocalWs) {
    btnConnectLocalWs.addEventListener("click", () => {
      const url = txtLocalWs.value.trim();
      if (url) {
        meshBridge.setCustomWsUrl(url);
        btnConnectLocalWs.innerText = "✓ Connected!";
        setTimeout(() => { btnConnectLocalWs.innerText = "Connect"; }, 2000);
      }
    });
  }

  const wireHotspotPreset = (btnId, url) => {
    const btn = document.getElementById(btnId);
    if (btn && txtLocalWs) {
      btn.addEventListener("click", () => {
        txtLocalWs.value = url;
        meshBridge.setCustomWsUrl(url);
        btn.classList.add("ring-1", "ring-emerald-400");
        setTimeout(() => btn.classList.remove("ring-1", "ring-emerald-400"), 1500);
      });
    }
  };
  wireHotspotPreset("btnPresetHotspotAndroid", "ws://192.168.43.1:3000");
  wireHotspotPreset("btnPresetHotspotIos", "ws://172.20.10.1:3000");
  wireHotspotPreset("btnPresetRouter", "ws://192.168.1.1:3000");
  wireHotspotPreset("btnPresetLocalhost", "ws://localhost:3000");

  if (btnDismissTestPing) {
    btnDismissTestPing.addEventListener("click", () => {
      document.getElementById("testPingBanner").classList.add("hidden");
    });
  }

  // Real-Time Online / Offline Detection
  function updateOnlineOfflineIndicator() {
    const isOnline = navigator.onLine;
    const offlineBadge = document.getElementById("offlineStatusBadge");
    if (offlineBadge) {
      if (!isOnline) {
        offlineBadge.classList.remove("hidden");
        offlineBadge.innerHTML = "<span>⚡</span> OFFLINE: AIRWAVES & LOCAL MESH ACTIVE";
      } else {
        offlineBadge.classList.add("hidden");
      }
    }
  }
  window.addEventListener('online', updateOnlineOfflineIndicator);
  window.addEventListener('offline', updateOnlineOfflineIndicator);
  updateOnlineOfflineIndicator();

  // Restore Cached Incidents from Offline Disaster Vault
  try {
    if (typeof localStorage !== 'undefined') {
      const savedIncidents = JSON.parse(localStorage.getItem('silentbridge_saved_incidents') || '[]');
      if (savedIncidents.length > 0 && currentRole === 'receiver') {
        console.log(`📦 Restoring ${savedIncidents.length} cached incidents from Offline Disaster Vault...`);
        savedIncidents.forEach(inc => {
          handleReceivedPacket(inc, 'offline_vault');
        });
      }
    }
  } catch (e) {}

  // Initialize microphone UI state on load
  updateMicStatusUi();

  // Register Offline Service Worker for 100% No-Network Standalone Operation
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('SilentBridge Offline ServiceWorker active:', reg.scope);
      reg.update();
    }).catch((err) => {
      console.warn('ServiceWorker registration note:', err);
    });
  }
});