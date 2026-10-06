// audioModem.js - Ultra-Reliable 4-FSK Acoustic Modem with Adaptive Microphone Demodulation
// Enables true off-grid device-to-device communication over speaker and microphone without internet

class AudioModem {
  constructor(onPacketReceived, onStatusChange) {
    this.audioCtx = null;
    this.micStream = null;
    this.analyser = null;
    this.micSource = null;
    this.isListening = false;
    this.isTransmitting = false;
    this.onPacketReceived = onPacketReceived || (() => {});
    this.onStatusChange = onStatusChange || (() => {});

    // Sound mode: 'audible' (1300Hz-2700Hz, recommended for all devices), 'ultrasound', or 'silent'
    this.soundMode = 'audible';
    this.visualizerCanvas = null;
    this.visualizerCtx = null;
    this.animFrameId = null;
    this.demodInterval = null;
    this.currentRxState = 'STANDBY';

    // FSK Protocol Parameters
    this.PILOT_FREQ = 950;
    this.SYNC_FREQ = 2700;
    this.DATA_FREQS = [1300, 1650, 2000, 2350]; // 350 Hz tone spacing for maximum noise immunity
    this.END_FREQ = 950;
    this.SYMBOL_MS = 80; // 80ms per 2-bit symbol with integrated energy matched filtering
  }

  setSoundMode(mode) {
    if (['audible', 'ultrasound', 'silent'].includes(mode)) {
      this.soundMode = mode;
      console.log("AudioModem sound mode set to:", mode);
    }
  }

  async initAudio() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (e) {
        console.warn("AudioContext resume note:", e);
      }
    }
    if (this.audioCtx && !this.analyser) {
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.1;
    }
    return this.audioCtx;
  }

  attachVisualizer(canvas) {
    if (!canvas) return;
    this.visualizerCanvas = canvas;
    this.visualizerCtx = canvas.getContext('2d');
    this.startVisualizerLoop();
  }

  startVisualizerLoop() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);

    const canvas = this.visualizerCanvas;
    const ctx = this.visualizerCtx;
    if (!canvas || !ctx) return;

    let timeOffset = 0;

    const render = () => {
      this.animFrameId = requestAnimationFrame(render);
      timeOffset += 0.05;

      const width = canvas.width;
      const height = canvas.height;

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, width, height);

      let hasLiveAudio = false;
      let dataArray = null;

      if (this.analyser) {
        const bufferLength = this.analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        for (let i = 20; i < 200; i++) {
          if (dataArray[i] > 15) {
            hasLiveAudio = true;
            break;
          }
        }
      }

      if (hasLiveAudio && dataArray) {
        const barCount = 48;
        const barWidth = width / barCount;

        for (let i = 0; i < barCount; i++) {
          const binIndex = 25 + Math.floor(i * 2.8);
          const val = dataArray[binIndex] || 0;
          const barHeight = Math.max(2, (val / 255) * (height - 4));

          const x = i * barWidth;
          const y = height - barHeight;

          if (this.isTransmitting) {
            ctx.fillStyle = '#ffffff';
          } else if (this.currentRxState === 'RECEIVING') {
            ctx.fillStyle = '#38bdf8'; // Cyan when decoding acoustic signal
          } else {
            ctx.fillStyle = val > 120 ? '#ffffff' : '#10b981'; // Green
          }

          ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
        }
      } else {
        // Idle Tactical Radar Waveform
        ctx.strokeStyle = this.isListening ? '#10b981' : '#404040';
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        const points = 32;
        for (let i = 0; i <= points; i++) {
          const x = (i / points) * width;
          const baseSine = Math.sin((i * 0.4) + timeOffset) * 2;
          const midY = (height / 2) + baseSine;
          if (i === 0) ctx.moveTo(x, midY);
          else ctx.lineTo(x, midY);
        }
        ctx.stroke();

        ctx.fillStyle = this.isListening ? '#10b981' : '#737373';
        ctx.font = '9px monospace';
        let label = 'ACOUSTIC STANDBY';
        if (this.isTransmitting) label = 'TX TRANSMITTING ACOUSTIC FSK';
        else if (this.currentRxState === 'RECEIVING') label = 'RX ACOUSTIC INCOMING BURST...';
        else if (this.isListening) label = 'RX AIRWAVES LISTENING (MIC ACTIVE)';

        ctx.fillText(label, width - 230, 18);
      }
    };

    render();
  }

  async startListening() {
    await this.initAudio();
    if (this.isListening) return;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          });
        } catch (constraintErr) {
          console.warn("Specialized microphone constraints unsupported on this device, using standard audio: true", constraintErr);
          this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        if (this.audioCtx && this.analyser) {
          this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
          this.micSource.connect(this.analyser);
        }

        this.isListening = true;
        this.onStatusChange("LISTENING (MIC ACTIVE)");
        console.log("🎤 Acoustic microphone monitoring & 4-FSK demodulator started.");
        this.startDemodulator();
      }
    } catch (err) {
      console.warn("Microphone access notice:", err.message);
      this.isListening = false;
      this.onStatusChange("MIC ACCESS DENIED");
    }
  }

  // 4-FSK Acoustic Transmitter (Phone / Laptop Speaker)
  async transmitPacket(uint8Array) {
    if (!uint8Array || uint8Array.length === 0) return;

    await this.initAudio();
    this.isTransmitting = true;
    this.onStatusChange("TRANSMITTING SOUND...");

    // Convert raw bytes into 2-bit symbols (4 symbols per byte)
    const symbols = [];
    for (let i = 0; i < uint8Array.length; i++) {
      const b = uint8Array[i];
      symbols.push((b >> 6) & 0x03);
      symbols.push((b >> 4) & 0x03);
      symbols.push((b >> 2) & 0x03);
      symbols.push(b & 0x03);
    }

    if (this.soundMode !== 'silent' && this.audioCtx) {
      try {
        const ctx = this.audioCtx;
        const now = ctx.currentTime + 0.03;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        if (this.analyser) {
          gain.connect(this.analyser);
        }
        gain.connect(ctx.destination);

        const pilotDur = 0.12;  // 120ms pilot lead-in
        const syncDur = 0.15;   // 150ms sync tone
        const symbolDur = this.SYMBOL_MS / 1000; // 0.080s per 2-bit symbol
        const endDur = 0.10;

        let t = now;
        gain.gain.setValueAtTime(0.001, t);
        // High volume (0.85) ensures phone speakers reach across room to laptop mic
        gain.gain.linearRampToValueAtTime(0.85, t + 0.02);

        // 1. Pilot Wakeup Tone (950 Hz)
        osc.frequency.setValueAtTime(this.PILOT_FREQ, t);
        t += pilotDur;

        // 2. Sync Start Tone (2700 Hz - clean marker)
        osc.frequency.setValueAtTime(this.SYNC_FREQ, t);
        t += syncDur;

        // 3. 4-FSK Data Symbols (1300, 1650, 2000, 2350 Hz)
        for (let i = 0; i < symbols.length; i++) {
          const freq = this.DATA_FREQS[symbols[i]];
          osc.frequency.setValueAtTime(freq, t);
          t += symbolDur;
        }

        // 4. End Tone (950 Hz)
        osc.frequency.setValueAtTime(this.END_FREQ, t);
        t += endDur;

        gain.gain.setValueAtTime(0.85, t);
        gain.gain.linearRampToValueAtTime(0.001, t + 0.03);

        osc.start(now);
        osc.stop(t + 0.05);

        const totalMs = Math.round((t - now + 0.1) * 1000);
        await new Promise(res => setTimeout(res, totalMs));
      } catch (err) {
        console.warn("Acoustic playback note:", err);
      }
    } else {
      await new Promise(res => setTimeout(res, 400));
    }

    this.isTransmitting = false;
    this.onStatusChange(this.isListening ? "LISTENING" : "READY");
  }

  // Real-Time 4-FSK Acoustic Demodulator with Integrating Energy Matched Filter
  startDemodulator() {
    if (this.demodInterval) clearInterval(this.demodInterval);

    let rxState = 'IDLE'; // IDLE, WAIT_SYNC_END, DATA
    let syncCounter = 0;
    let syncDetectTime = 0;
    let rxSymbols = [];
    let expectedSymbols = 56;
    let symbolStartTime = 0;
    let energyAccumulators = [0, 0, 0, 0];

    const FFT_SIZE = 2048;

    this.demodInterval = setInterval(() => {
      if (!this.analyser || this.isTransmitting) return;

      const SAMPLE_RATE = (this.audioCtx && this.audioCtx.sampleRate) || 48000;
      const bufferLength = this.analyser.frequencyBinCount;
      const freqData = new Uint8Array(bufferLength);
      this.analyser.getByteFrequencyData(freqData);

      // Search ±2 FFT bins around target frequency to accommodate speaker/mic acoustic drift
      const getEnergy = (freq) => {
        const bin = Math.round(freq * FFT_SIZE / SAMPLE_RATE);
        return Math.max(
          freqData[bin - 2] || 0,
          freqData[bin - 1] || 0,
          freqData[bin] || 0,
          freqData[bin + 1] || 0,
          freqData[bin + 2] || 0
        );
      };

      // Measure ambient noise floor away from sync/data band (bins 20-35 and 130-150)
      let noiseSum = 0;
      for (let b = 20; b <= 35; b += 3) noiseSum += freqData[b];
      for (let b = 130; b <= 145; b += 3) noiseSum += freqData[b];
      const noiseFloor = noiseSum / 12;

      const now = performance.now();
      const syncEnergy = getEnergy(this.SYNC_FREQ);

      if (rxState === 'IDLE') {
        this.currentRxState = 'LISTENING';
        // 2-tick confirmation guarantees lock onto true 150ms 2700Hz sync tone, rejecting noise spikes
        if (syncEnergy > Math.max(18, noiseFloor + 8)) {
          syncCounter++;
          if (syncCounter >= 2) {
            rxState = 'WAIT_SYNC_END';
            syncDetectTime = now;
          }
        } else {
          syncCounter = 0;
        }
      } else if (rxState === 'WAIT_SYNC_END') {
        // Sync tone ends: sync frequency energy drops OR max sync duration reached
        const syncEnded = (syncEnergy < Math.max(14, noiseFloor + 6)) || (now - syncDetectTime > 160);

        if (syncEnded) {
          rxState = 'DATA';
          this.currentRxState = 'RECEIVING';
          rxSymbols = [];
          expectedSymbols = 56;
          symbolStartTime = now;
          energyAccumulators = [0, 0, 0, 0];
          console.log("🔊 Acoustic sync locked! Receiving data symbols with energy integration...");
          this.onStatusChange("RX ACOUSTIC INCOMING...");
        } else if (now - syncDetectTime > 350) {
          rxState = 'IDLE';
          syncCounter = 0;
        }
      } else if (rxState === 'DATA') {
        // Accumulate energy across the entire symbol duration (Matched Filter)
        for (let s = 0; s < 4; s++) {
          energyAccumulators[s] += getEnergy(this.DATA_FREQS[s]);
        }

        // When symbol duration has elapsed, pick the frequency with maximum integrated energy
        if (now - symbolStartTime >= this.SYMBOL_MS) {
          let bestSymbol = 0;
          let maxEnergy = -1;

          for (let s = 0; s < 4; s++) {
            if (energyAccumulators[s] > maxEnergy) {
              maxEnergy = energyAccumulators[s];
              bestSymbol = s;
            }
          }

          rxSymbols.push(bestSymbol);
          energyAccumulators = [0, 0, 0, 0];
          symbolStartTime += this.SYMBOL_MS;

          // Dynamically resolve packet length at symbol 16 (after byte 3):
          // byte 3: 0xFF (ACK) or 0xFD (Test Ping) -> 24 symbols (6 bytes)
          // byte 3: 1..4 (Emergency SOS) -> 56 symbols (14 bytes)
          if (rxSymbols.length === 16) {
            const byte3 = (rxSymbols[12] << 6) | (rxSymbols[13] << 4) | (rxSymbols[14] << 2) | rxSymbols[15];
            if (byte3 === 0xFF || byte3 === 0xFD) {
              expectedSymbols = 24;
            } else {
              expectedSymbols = 56;
            }
          }

          if (rxSymbols.length >= expectedSymbols || (now - syncDetectTime > 6000)) {
            console.log(`🔊 Acoustic burst finished. Received ${rxSymbols.length}/${expectedSymbols} symbols.`);
            rxState = 'IDLE';
            syncCounter = 0;
            this.currentRxState = 'LISTENING';
            this.processReceivedSymbols(rxSymbols);
          }
        }
      }
    }, 15);
  }

  processReceivedSymbols(symbols) {
    if (!symbols || symbols.length < 24) {
      this.onStatusChange(this.isListening ? "LISTENING" : "READY");
      return;
    }

    // Convert 2-bit symbols back into 8-bit bytes (4 symbols per byte)
    const bytes = [];
    for (let i = 0; i + 3 < symbols.length; i += 4) {
      const b = (symbols[i] << 6) | (symbols[i + 1] << 4) | (symbols[i + 2] << 2) | symbols[i + 3];
      bytes.push(b);
    }

    const uint8 = new Uint8Array(bytes);
    console.log("Decoded raw acoustic bytes:", Array.from(uint8).map(b => b.toString(16).padStart(2, '0')).join(' '));

    let decoded = null;
    if (typeof PacketEngine !== 'undefined') {
      if (typeof PacketEngine.decodeAcoustic === 'function') {
        decoded = PacketEngine.decodeAcoustic(uint8);
      }
      if (!decoded && typeof PacketEngine.decode === 'function') {
        decoded = PacketEngine.decode(uint8);
      }
    }

    if (decoded) {
      console.log("✅ Valid acoustic packet decoded via microphone:", decoded);
      this.playAlarmChime();
      if (this.onPacketReceived) {
        this.onPacketReceived(decoded);
      }
      this.onStatusChange("✓ ACOUSTIC PACKET DECODED!");
      setTimeout(() => {
        this.onStatusChange(this.isListening ? "LISTENING" : "READY");
      }, 3500);
    } else {
      console.warn("Acoustic packet CRC failed or data incomplete.");
      this.onStatusChange(this.isListening ? "LISTENING" : "READY");
    }
  }

  playAlarmChime() {
    try {
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.2);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.35);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {}
  }

  // Instant speaker verification chirp
  async playTestChirp() {
    await this.initAudio();
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    if (this.analyser) osc.connect(this.analyser);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1300, now);
    osc.frequency.linearRampToValueAtTime(2700, now + 0.4);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.05);
    gain.gain.linearRampToValueAtTime(0.001, now + 0.4);

    osc.start(now);
    osc.stop(now + 0.45);
  }
}

if (typeof window !== 'undefined') {
  window.AudioModem = AudioModem;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioModem;
}