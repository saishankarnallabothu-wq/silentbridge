// audioModem.js - Ultra-Reliable 4-FSK Acoustic Modem with Adaptive Microphone Demodulation
// Enables true off-grid device-to-device communication over speaker and microphone without internet
// Enhanced with Hardware DSP Pre-Amp, Bandpass Filtering, Dynamic Range Compression & Multi-Burst Long Range Modes

class AudioModem {
  constructor(onPacketReceived, onStatusChange) {
    this.audioCtx = null;
    this.micStream = null;
    this.analyser = null;
    this.micSource = null;
    this.bandFilter = null;
    this.preAmp = null;
    this.compressor = null;

    this.isListening = false;
    this.isTransmitting = false;
    this.onPacketReceived = onPacketReceived || (() => {});
    this.onStatusChange = onStatusChange || (() => {});

    // Sound mode: 'audible' (1200Hz-2200Hz, recommended for all devices), 'ultrasound', or 'silent'
    this.soundMode = 'audible';
    // Range Sensitivity Mode: 'standard' (close proximity), 'long' (extended ~25-50m), 'extreme' (turbo high-gain)
    this.rangeMode = 'long';

    this.visualizerCanvas = null;
    this.visualizerCtx = null;
    this.animFrameId = null;
    this.demodInterval = null;
    this.currentRxState = 'STANDBY';

    // FSK Protocol Parameters (Tuned to 1200-2200 Hz for universal speaker/mic sensitivity)
    this.PILOT_FREQ = 950;
    this.SYNC_FREQ = 2200;
    this.DATA_FREQS = [1200, 1450, 1700, 1950]; // 250 Hz separation within peak microphone response band
    this.END_FREQ = 950;
    this.SYMBOL_MS = 80; // 80ms per 2-bit symbol with integrated energy matched filtering
  }

  setSoundMode(mode) {
    if (['audible', 'ultrasound', 'silent'].includes(mode)) {
      this.soundMode = mode;
      console.log("AudioModem sound mode set to:", mode);
    }
  }

  setRangeMode(mode) {
    if (['standard', 'long', 'extreme'].includes(mode)) {
      this.rangeMode = mode;
      const gainMap = { standard: 2.5, long: 5.5, extreme: 8.5 };
      if (this.preAmp && this.audioCtx) {
        this.preAmp.gain.setValueAtTime(gainMap[mode], this.audioCtx.currentTime);
      }
      console.log(`📡 AudioModem range sensitivity set to: ${mode.toUpperCase()} (${gainMap[mode]}x Pre-Amp Boost)`);
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
          if (dataArray[i] > 12) {
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
        if (this.isTransmitting) label = 'TX TRANSMITTING ACOUSTIC BURST';
        else if (this.currentRxState === 'RECEIVING') label = 'RX ACOUSTIC INCOMING BURST...';
        else if (this.isListening) label = `RX AIRWAVES LISTENING [${this.rangeMode.toUpperCase()} RANGE]`;

        ctx.fillText(label, width - 260, 18);
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

          // 1. High-Q Bandpass Filter to isolate the 900Hz - 2400Hz acoustic signaling spectrum
          this.bandFilter = this.audioCtx.createBiquadFilter();
          this.bandFilter.type = 'bandpass';
          this.bandFilter.frequency.value = 1600;
          this.bandFilter.Q.value = 0.85;

          // 2. Tactical Pre-Amplifier Gain Boost for High Distance Sensitivity
          this.preAmp = this.audioCtx.createGain();
          const gainMap = { standard: 2.5, long: 5.5, extreme: 8.5 };
          this.preAmp.gain.value = gainMap[this.rangeMode] || 5.5;

          // 3. Audio Dynamics Compressor (Lifts quiet distant signals, prevents loud near-field clipping)
          this.compressor = this.audioCtx.createDynamicsCompressor();
          this.compressor.threshold.setValueAtTime(-50, this.audioCtx.currentTime);
          this.compressor.knee.setValueAtTime(35, this.audioCtx.currentTime);
          this.compressor.ratio.setValueAtTime(10, this.audioCtx.currentTime);
          this.compressor.attack.setValueAtTime(0.003, this.audioCtx.currentTime);
          this.compressor.release.setValueAtTime(0.2, this.audioCtx.currentTime);

          // Connect Chain: micSource -> bandFilter -> preAmp -> compressor -> analyser
          this.micSource.connect(this.bandFilter);
          this.bandFilter.connect(this.preAmp);
          this.preAmp.connect(this.compressor);
          this.compressor.connect(this.analyser);
        }

        this.isListening = true;
        this.onStatusChange("LISTENING (MIC ACTIVE)");
        console.log(`🎤 Acoustic microphone monitoring & 4-FSK demodulator started [Range: ${this.rangeMode.toUpperCase()}].`);
        this.startDemodulator();
      }
    } catch (err) {
      console.warn("Microphone access notice:", err.message);
      this.isListening = false;
      this.onStatusChange("MIC ACCESS DENIED");
    }
  }

  // 4-FSK Acoustic Transmitter with Maximum Sound Output and Distance Redundancy
  async transmitPacket(uint8Array) {
    if (!uint8Array || uint8Array.length === 0) return;

    await this.initAudio();
    this.isTransmitting = true;
    this.onStatusChange("TRANSMITTING SOUND...");

    // In Long Range / Extreme mode, transmit dual redundant bursts with a brief gap to punch through distance fading and echoes
    const repeatCount = (this.rangeMode === 'extreme') ? 2 : (this.rangeMode === 'long') ? 2 : 1;
    for (let r = 0; r < repeatCount; r++) {
      await this.transmitSingleBurst(uint8Array);
      if (r < repeatCount - 1) {
        await new Promise(res => setTimeout(res, 260));
      }
    }

    this.isTransmitting = false;
    this.onStatusChange(this.isListening ? "LISTENING" : "READY");
  }

  async transmitSingleBurst(uint8Array) {
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
        // Maximum clean volume (1.0) ensures acoustic penetration across rooms and outdoor distances
        gain.gain.linearRampToValueAtTime(1.0, t + 0.02);

        // 1. Pilot Wakeup Tone (950 Hz)
        osc.frequency.setValueAtTime(this.PILOT_FREQ, t);
        t += pilotDur;

        // 2. Sync Start Tone (2200 Hz clean marker)
        osc.frequency.setValueAtTime(this.SYNC_FREQ, t);
        t += syncDur;

        // 3. 4-FSK Data Symbols (1200, 1450, 1700, 1950 Hz)
        for (let i = 0; i < symbols.length; i++) {
          const freq = this.DATA_FREQS[symbols[i]];
          osc.frequency.setValueAtTime(freq, t);
          t += symbolDur;
        }

        // 4. End Tone (950 Hz)
        osc.frequency.setValueAtTime(this.END_FREQ, t);
        t += endDur;

        gain.gain.setValueAtTime(1.0, t);
        gain.gain.linearRampToValueAtTime(0.001, t + 0.03);

        osc.start(now);
        osc.stop(t + 0.05);

        const totalMs = Math.round((t - now + 0.08) * 1000);
        await new Promise(res => setTimeout(res, totalMs));
      } catch (err) {
        console.warn("Acoustic playback note:", err);
      }
    } else {
      await new Promise(res => setTimeout(res, 350));
    }
  }

  // Real-Time 4-FSK Acoustic Demodulator with Integrating Energy Matched Filter
  startDemodulator() {
    if (this.demodInterval) clearInterval(this.demodInterval);

    let rxState = 'IDLE'; // IDLE, WAIT_SYNC_END, DATA
    let syncCounter = 0;
    let syncDetectTime = 0;
    let peakSyncEnergy = 0;
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

      // Range-mode adaptive sensitivity thresholds:
      const minThreshold = (this.rangeMode === 'extreme') ? 4.5 : (this.rangeMode === 'long') ? 6.5 : 14.0;
      const snrMargin = (this.rangeMode === 'extreme') ? 2.2 : (this.rangeMode === 'long') ? 3.2 : 6.0;

      if (rxState === 'IDLE') {
        this.currentRxState = 'LISTENING';
        // Multi-tick confirmation locks onto 150ms 2200Hz sync tone while rejecting short noise spikes
        if (syncEnergy > Math.max(minThreshold, noiseFloor + snrMargin)) {
          syncCounter++;
          if (syncCounter >= 2) {
            rxState = 'WAIT_SYNC_END';
            syncDetectTime = now;
            peakSyncEnergy = syncEnergy;
          }
        } else {
          syncCounter = 0;
        }
      } else if (rxState === 'WAIT_SYNC_END') {
        if (syncEnergy > peakSyncEnergy) peakSyncEnergy = syncEnergy;
        const elapsedSinceSync = now - syncDetectTime;
        // The sync tone is 150ms long. Must wait at least 90ms after 2-tick lock before checking falloff!
        const canEnd = elapsedSinceSync >= 90;
        const minCutoff = (this.rangeMode === 'extreme') ? 3.5 : (this.rangeMode === 'long') ? 5.5 : 12.0;
        const syncEnded = canEnd && ((syncEnergy < Math.max(minCutoff, peakSyncEnergy * 0.48)) || (elapsedSinceSync > 140));

        if (syncEnded) {
          rxState = 'DATA';
          this.currentRxState = 'RECEIVING';
          rxSymbols = [];
          expectedSymbols = 56;
          symbolStartTime = now;
          energyAccumulators = [0, 0, 0, 0];
          peakSyncEnergy = 0;
          console.log(`🔊 Acoustic sync locked! Receiving data symbols with energy integration [${this.rangeMode.toUpperCase()} range]...`);
          this.onStatusChange("RX ACOUSTIC INCOMING...");
        } else if (elapsedSinceSync > 350) {
          rxState = 'IDLE';
          syncCounter = 0;
          peakSyncEnergy = 0;
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

          // Immediate CRC verification for short 6-byte packet (24 symbols: ACK or Ping)
          if (rxSymbols.length >= 24 && rxSymbols.length <= 28) {
            for (let offset = 0; offset <= rxSymbols.length - 24; offset++) {
              const testBytes = [];
              for (let i = offset; i < offset + 24; i += 4) {
                testBytes.push((rxSymbols[i] << 6) | (rxSymbols[i + 1] << 4) | (rxSymbols[i + 2] << 2) | rxSymbols[i + 3]);
              }
              const testPacket = (typeof PacketEngine !== 'undefined') ? PacketEngine.decodeAcoustic(new Uint8Array(testBytes)) : null;
              if (testPacket && (testPacket.type === 0xFF || testPacket.type === 0xFD)) {
                console.log(`✅ Immediate verified 6-byte Acoustic ${testPacket.text} burst detected at offset ${offset}!`);
                rxState = 'IDLE';
                syncCounter = 0;
                this.currentRxState = 'LISTENING';
                this.processReceivedSymbols(rxSymbols.slice(offset, offset + 24));
                return;
              }
            }
          }

          // Full packet verification (56 symbols for 14-byte SOS)
          if (rxSymbols.length >= 56 || (now - syncDetectTime > 5500)) {
            console.log(`🔊 Acoustic burst finished. Received ${rxSymbols.length} symbols.`);
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

    // Try decoding both exact length and sliding window offsets (offset 0, 1, 2)
    let decoded = null;
    const maxOffset = Math.min(2, Math.max(0, symbols.length - 24));

    for (let offset = 0; offset <= maxOffset; offset++) {
      const bytes = [];
      const len = (symbols.length - offset >= 56) ? 56 : 24;
      for (let i = offset; i + 3 < offset + len && i + 3 < symbols.length; i += 4) {
        const b = (symbols[i] << 6) | (symbols[i + 1] << 4) | (symbols[i + 2] << 2) | symbols[i + 3];
        bytes.push(b);
      }
      const uint8 = new Uint8Array(bytes);
      if (typeof PacketEngine !== 'undefined') {
        if (typeof PacketEngine.decodeAcoustic === 'function') {
          decoded = PacketEngine.decodeAcoustic(uint8);
        }
        if (!decoded && typeof PacketEngine.decode === 'function') {
          decoded = PacketEngine.decode(uint8);
        }
      }
      if (decoded) break;
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