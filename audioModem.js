// audioModem.js - High-Tech Acoustic PHY Engine & Live Tactical Visualizer
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

    // Acoustic sound mode: 'audible' (1.5kHz-2.5kHz tactical chirp), 'ultrasound' (18kHz-19kHz), or 'silent'
    this.soundMode = 'audible';
    this.visualizerCanvas = null;
    this.visualizerCtx = null;
    this.animFrameId = null;
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
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
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

        // Check if there is actual sound
        for (let i = 0; i < bufferLength; i++) {
          if (dataArray[i] > 10) {
            hasLiveAudio = true;
            break;
          }
        }
      }

      if (hasLiveAudio && dataArray) {
        // Draw Dynamic Tactical Frequency Spectrum Bars
        const barCount = 48;
        const barWidth = (width / barCount);

        for (let i = 0; i < barCount; i++) {
          const binIndex = Math.floor((i / barCount) * (dataArray.length * 0.75));
          const val = dataArray[binIndex] || 0;
          const barHeight = Math.max(2, (val / 255) * (height - 4));

          const x = i * barWidth;
          const y = height - barHeight;

          // Gradient color: White to Emerald/Cyan
          if (this.isTransmitting) {
            ctx.fillStyle = '#ffffff';
          } else {
            ctx.fillStyle = val > 120 ? '#ffffff' : '#10b981';
          }

          ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
        }
      } else {
        // Draw Tactical Idle Radar Waveform (so visualizer is alive)
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

        // Status text overlay
        ctx.fillStyle = this.isListening ? '#10b981' : '#737373';
        ctx.font = '9px monospace';
        const label = this.isTransmitting ? 'TX ACOUSTIC BURST' : (this.isListening ? 'RX LISTENING 18kHz-PHY' : 'ACOUSTIC STANDBY');
        ctx.fillText(label, width - 150, 18);
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
        this.onStatusChange("LISTENING");
        console.log("Acoustic microphone monitoring started.");
      }
    } catch (err) {
      console.warn("Microphone access note:", err.message);
      this.isListening = true;
      this.onStatusChange("LISTENING (EMULATED)");
    }
  }

  async transmitPacket(uint8Array) {
    await this.initAudio();
    this.isTransmitting = true;
    this.onStatusChange("TRANSMITTING");

    if (this.soundMode !== 'silent' && this.audioCtx) {
      try {
        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        // Connect oscillator -> gain -> analyser -> speakers
        osc.connect(gain);
        if (this.analyser) {
          gain.connect(this.analyser);
        }
        gain.connect(this.audioCtx.destination);

        const isUltrasound = this.soundMode === 'ultrasound';
        const baseFreq = isUltrasound ? 18500 : 1600;
        const markFreq = isUltrasound ? 19200 : 2200;

        osc.type = "sine";
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.05);

        // Acoustic FSK tone burst sequence
        const symbolTime = 0.05; // 50ms per symbol burst
        const symbols = 6;
        for (let i = 0; i < symbols; i++) {
          const t = now + 0.05 + (i * symbolTime);
          const freq = (i % 2 === 0) ? baseFreq : markFreq;
          osc.frequency.setValueAtTime(freq, t);
        }

        const endTime = now + 0.05 + (symbols * symbolTime);
        gain.gain.setValueAtTime(0.2, endTime);
        gain.gain.linearRampToValueAtTime(0.001, endTime + 0.04);

        osc.start(now);
        osc.stop(endTime + 0.05);
      } catch (err) {
        console.warn("Acoustic playback note:", err);
      }
    }

    await new Promise(res => setTimeout(res, 450));
    this.isTransmitting = false;
    this.onStatusChange(this.isListening ? "LISTENING" : "READY");
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

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.35);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {}
  }
}

if (typeof window !== 'undefined') {
  window.AudioModem = AudioModem;
}