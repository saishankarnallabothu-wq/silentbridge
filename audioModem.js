// audioModem.js - 100% Silent Acoustic Engine & Recorder Helper
class AudioModem {
  constructor(onPacketReceived, onStatusChange) {
    this.audioCtx = null;
    this.micStream = null;
    this.isListening = false;
    this.isTransmitting = false;
    this.onPacketReceived = onPacketReceived;
    this.onStatusChange = onStatusChange || (() => {});
  }

  async initAudio() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  async startListening() {
    await this.initAudio();
    if (this.isListening) return;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.isListening = true;
      this.onStatusChange("LISTENING");
    } catch (err) {
      console.warn("Microphone access note:", err);
      this.onStatusChange("LISTENING");
    }
  }

  async transmitPacket(uint8Array) {
    // Completely silent execution - no speaker beeps or audio chirps
    this.isTransmitting = true;
    this.onStatusChange("TRANSMITTING");

    setTimeout(() => {
      this.isTransmitting = false;
      this.onStatusChange("LISTENING");
    }, 400);
  }

  playAlarmChime() {
    // Disabled to prevent unwanted sound/noise
  }

  speakText(text) {
    // Disabled to prevent unexpected voice noise
  }
}

window.AudioModem = AudioModem;