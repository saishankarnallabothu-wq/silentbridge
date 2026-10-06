// audioModem.js - Full Acoustic FSK Modulator & Real-Time FFT Demodulator
// Enables true off-grid device-to-device communication over speaker and microphone with ZERO internet/cellular

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

    // Sound mode: 'audible' (1600Hz-2800Hz, universal), 'ultrasound' (18.8kHz-20kHz), or 'silent'
    this.soundMode = 'audible';
    this.visualizerCanvas = null;
    this.visualizerCtx = null;
    this.animFrameId = null;
    this.demodInterval = null;
    this.currentRxState = 'STANDBY';
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
      this.analyser.smoothingTimeConstant = 0.15; // fast symbol reaction
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

        for (let i = 0; i < 250; i++) {
          if (dataArray[i] > 18) {
            hasLiveAudio = true;
            break;
          }
        }
      }

      if (hasLiveAudio && dataArray) {
        const barCount = 48;
        const barWidth = width / barCount;

        for (let i = 0; i < barCount; i++) {
          // Focus visualizer on the acoustic data band (approx bins 30 to 180: 600Hz to 3800Hz)
          const binIndex = 30 + Math.floor(i * 3.2);
          const val = dataArray[binIndex] || 0;
          const barHeight = Math.max(2, (val / 255) * (height - 4));

          const x = i * barWidth;
          const y = height - barHeight;

          if (this.isTransmitting) {
            ctx.fillStyle = '#ffffff';
          } else if (this.currentRxState === 'RECEIVING') {
            ctx.fillStyle = '#38bdf8'; // Cyan when locking incoming data
          } else {
            ctx.fillStyle = val > 130 ? '#ffffff' : '#10b981'; // Green
          }

          ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
        }
      } else {
        // Idle Tactical Waveform
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
        if (this.isTransmitting) label = 'TX BROADCASTING FSK SOUND';
        else if (this.currentRxState === 'RECEIVING') label = 'RX INCOMING ACOUSTIC BURST...';
        else if (this.isListening) label = 'RX AIRWAVES LISTENING (MIC ON)';

        ctx.fillText(label, width - 210, 18);
      }
    };

    render();
  }

  async startListening() {
    await this.initAudio();
    if (this.isListening) return;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });

        if (this.audioCtx && this.analyser) {
          this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
          this.micSource.connect(this.analyser);
        }

        this.isListening = true;
        this.onStatusChange("LISTENING (MIC ACTIVE)");
        console.log("🎤 Acoustic microphone monitoring and demodulator started.");
        this.startDemodulator();
      }
    } catch (err) {
      console.warn("Microphone access notice:", err.message);
      this.isListening = false;
      this.onStatusChange("MIC ACCESS DENIED");
    }
  }

  // 16-FSK Acoustic Modulation (Transmitter)
  async transmitPacket(uint8Array) {
    if (!uint8Array || uint8Array.length === 0) return;

    await this.initAudio();
    this.isTransmitting = true;
    this.onStatusChange("TRANSMITTING SOUND...");

    // Convert raw bytes into 4-bit nibbles (0 to 15)
    const nibbles = [];
    for (let i = 0; i < uint8Array.length; i++) {
      nibbles.push((uint8Array[i] >> 4) & 0x0F);
      nibbles.push(uint8Array[i] & 0x0F);
    }

    if (this.soundMode !== 'silent' && this.audioCtx) {
      try {
        const ctx = this.audioCtx;
        const now = ctx.currentTime + 0.05;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        if (this.analyser) {
          gain.connect(this.analyser);
        }
        gain.connect(ctx.destination);

        const isUltrasound = this.soundMode === 'ultrasound';
        const preambles = isUltrasound ? [17500, 18000, 18500] : [1000, 1200, 1400];
        const baseFreq = isUltrasound ? 18800 : 1600;
        const stepFreq = isUltrasound ? 70 : 80;
        const postamble = isUltrasound ? 20200 : 3000;

        const preambleDur = 0.09; // 90ms per preamble tone
        const symbolDur = 0.08;   // 80ms per data nibble
        const postambleDur = 0.09;

        let t = now;
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.35, t + 0.03);

        // 1. Preamble Sequence
        for (let i = 0; i < preambles.length; i++) {
          osc.frequency.setValueAtTime(preambles[i], t);
          t += preambleDur;
        }

        // 2. Data Nibbles (16-FSK)
        for (let i = 0; i < nibbles.length; i++) {
          const freq = baseFreq + (nibbles[i] * stepFreq);
          osc.frequency.setValueAtTime(freq, t);
          t += symbolDur;
        }

        // 3. Postamble End Tone
        osc.frequency.setValueAtTime(postamble, t);
        t += postambleDur;

        gain.gain.setValueAtTime(0.35, t);
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

  // Real-Time 16-FSK Acoustic Demodulator (Receiver)
  startDemodulator() {
    if (this.demodInterval) clearInterval(this.demodInterval);

    let rxState = 'IDLE'; // IDLE, P1, P2, WAIT_PREAMBLE_END, DATA
    let rxNibbles = [];
    let lastSampleTime = 0;
    let p1Time = 0;
    let p2Time = 0;

    const SAMPLE_RATE = this.audioCtx ? this.audioCtx.sampleRate : 44100;
    const FFT_SIZE = 2048;

    this.demodInterval = setInterval(() => {
      if (!this.analyser || this.isTransmitting) return;

      const bufferLength = this.analyser.frequencyBinCount;
      const freqData = new Uint8Array(bufferLength);
      this.analyser.getByteFrequencyData(freqData);

      const isUltrasound = this.soundMode === 'ultrasound';
      const preambles = isUltrasound ? [17500, 18000, 18500] : [1000, 1200, 1400];
      const baseFreq = isUltrasound ? 18800 : 1600;
      const stepFreq = isUltrasound ? 70 : 80;
      const postamble = isUltrasound ? 20200 : 3000;
      const symbolMs = 80;

      const getEnergy = (freq) => {
        const bin = Math.round(freq * FFT_SIZE / SAMPLE_RATE);
        return Math.max(freqData[bin - 1] || 0, freqData[bin] || 0, freqData[bin + 1] || 0);
      };

      const now = performance.now();

      if (rxState === 'IDLE') {
        this.currentRxState = 'LISTENING';
        if (getEnergy(preambles[0]) > 130) {
          rxState = 'P1';
          p1Time = now;
        }
      } else if (rxState === 'P1') {
        if (now - p1Time > 260) {
          rxState = 'IDLE'; // timeout
        } else if (getEnergy(preambles[1]) > 130) {
          rxState = 'P2';
          p2Time = now;
        }
      } else if (rxState === 'P2') {
        if (now - p2Time > 260) {
          rxState = 'IDLE'; // timeout
        } else if (getEnergy(preambles[2]) > 130) {
          rxState = 'WAIT_PREAMBLE_END';
        }
      } else if (rxState === 'WAIT_PREAMBLE_END') {
        // Wait until preamble 1400Hz ends, synchronizing receiver clock with transmitter!
        if (getEnergy(preambles[2]) < 110 || now - p2Time > 360) {
          rxState = 'DATA';
          this.currentRxState = 'RECEIVING';
          rxNibbles = [];
          lastSampleTime = now + (symbolMs / 2); // sample in middle of first symbol
          console.log("🔊 Acoustic preamble locked! Decoding incoming audio nibbles...");
          this.onStatusChange("RX ACOUSTIC INCOMING...");
        }
      } else if (rxState === 'DATA') {
        if (now >= lastSampleTime) {
          // Detect highest energy among candidate nibble frequencies (1600Hz to 2800Hz)
          let bestNibble = -1;
          let maxEnergy = 75;

          for (let n = 0; n < 16; n++) {
            const freq = baseFreq + (n * stepFreq);
            const e = getEnergy(freq);
            if (e > maxEnergy) {
              maxEnergy = e;
              bestNibble = n;
            }
          }

          if (bestNibble !== -1) {
            rxNibbles.push(bestNibble);
            lastSampleTime += symbolMs;
          }

          // Check for postamble tone (3000Hz) or timeout / max length (40 bytes = 80 nibbles)
          const postEnergy = getEnergy(postamble);
          if (postEnergy > 140 || rxNibbles.length >= 80 || (now - lastSampleTime > 320)) {
            console.log(`🔊 Acoustic burst finished. Total nibbles collected: ${rxNibbles.length}`);
            rxState = 'IDLE';
            this.currentRxState = 'LISTENING';
            this.processReceivedNibbles(rxNibbles);
          }
        }
      }
    }, 20);
  }

  processReceivedNibbles(rxNibbles) {
    if (!rxNibbles || rxNibbles.length < 12) {
      this.onStatusChange(this.isListening ? "LISTENING" : "READY");
      return;
    }

    // Convert pairs of 4-bit nibbles back into 8-bit bytes
    const bytes = [];
    for (let i = 0; i + 1 < rxNibbles.length; i += 2) {
      bytes.push((rxNibbles[i] << 4) | rxNibbles[i + 1]);
    }

    const uint8 = new Uint8Array(bytes);
    console.log("Decoded raw acoustic bytes:", Array.from(uint8).map(b => b.toString(16).padStart(2, '0')).join(' '));

    let decoded = null;
    if (typeof PacketEngine !== 'undefined') {
      // 1. Try Compact Acoustic format (14 bytes for SOS, 6 bytes for ACK)
      if (typeof PacketEngine.decodeAcoustic === 'function') {
        decoded = PacketEngine.decodeAcoustic(uint8);
      }
      // 2. Fallback to Full 40-byte PacketEngine format
      if (!decoded && uint8.length >= 40 && typeof PacketEngine.decode === 'function') {
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
      }, 3000);
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

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.35);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {}
  }
}

if (typeof window !== 'undefined') {
  window.AudioModem = AudioModem;
}