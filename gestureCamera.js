// gestureCamera.js - SafetyPipeline Hands-Free Emergency Gesture Engine (SilentBridge)
// 100% Offline Pure-JS Canvas Computer Vision with 1.2s continuous hold & 350ms noise debounce.

(function (window) {
  'use strict';

  // =========================================================================
  // 🛡️ SafetyPipeline State Machine (Exact User Specification)
  // =========================================================================
  const SafetyPipeline = {
    // Gesture Hold Configuration & State (1.2s smooth hold with 350ms noise debounce)
    gesture: {
      active: false,
      cameraStream: null,
      handsDetector: null,
      currentDetectedGesture: null,
      holdStartTime: null,
      holdDurationMs: 1200,
      isHolding: false,
      holdAnimFrameRef: null,
      graceTimeoutId: null
    },

    cleanupAllTimers() {
      if (this.gesture.holdAnimFrameRef) {
        cancelAnimationFrame(this.gesture.holdAnimFrameRef);
        this.gesture.holdAnimFrameRef = null;
      }
      if (this.gesture.graceTimeoutId) {
        clearTimeout(this.gesture.graceTimeoutId);
        this.gesture.graceTimeoutId = null;
      }
    },

    onGestureDetected(gestureName, rawLandmarks = null) {
      if (!gestureName) {
        // If hand detection dropped for a frame, wait for grace period before resetting hold
        if (this.gesture.isHolding && !this.gesture.graceTimeoutId) {
          this.gesture.graceTimeoutId = setTimeout(() => {
            this.resetGestureHold();
            this.updateGestureBadge(null);
            this.updatePillHighlights(null);
            this.gesture.graceTimeoutId = null;
          }, 350);
        }
        return;
      }

      // Valid gesture detected -> clear pending grace cancel
      if (this.gesture.graceTimeoutId) {
        clearTimeout(this.gesture.graceTimeoutId);
        this.gesture.graceTimeoutId = null;
      }

      // If new gesture started
      if (this.gesture.currentDetectedGesture !== gestureName) {
        this.resetGestureHold();
        this.gesture.currentDetectedGesture = gestureName;
        this.gesture.holdStartTime = Date.now();
        this.gesture.isHolding = true;
        this.updateGestureBadge(gestureName);
        this.updatePillHighlights(gestureName);
        this.startHoldCountdown(gestureName);
      }
    },

    startHoldCountdown(gestureName) {
      const hud = document.getElementById('gestureHoldHud');
      const progressBar = document.getElementById('gestureHoldProgressBar');
      const percentText = document.getElementById('gestureHoldPercentText');
      const label = document.getElementById('gestureHoldLabel');

      if (hud) {
        hud.classList.remove('hidden');
        hud.style.display = 'flex';
      }

      const gestureTitles = {
        FIST: '✊ CLOSED FIST (PANIC SOS)',
        POINTING: '☝️ POINTING (MEDICAL SOS)',
        V_SIGN: '✌️ V-SIGN (EVAC / RESCUE SOS)',
        PALM: '✋ OPEN PALM (DISTRESS SOS)'
      };

      if (label) label.textContent = `CONFIRMING ${gestureTitles[gestureName] || gestureName}...`;

      const checkProgress = () => {
        if (!this.gesture.isHolding || !this.gesture.holdStartTime) return;

        const elapsed = Date.now() - this.gesture.holdStartTime;
        const progress = Math.min(100, (elapsed / this.gesture.holdDurationMs) * 100);

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (percentText) percentText.textContent = `${Math.round(progress)}%`;

        // Circular companion HUD update
        const circleContainer = document.getElementById('hudHoldCountdownContainer');
        const circleRing = document.getElementById('hudHoldSvgRing');
        const circleSec = document.getElementById('hudHoldSecondsText');
        const circleEmoji = document.getElementById('hudHoldEmoji');
        if (circleContainer) circleContainer.classList.remove('hidden');
        if (circleRing) {
          const circumference = 188.5;
          circleRing.style.strokeDashoffset = circumference * (1 - progress / 100);
          circleRing.style.stroke = progress > 70 ? '#10b981' : '#a855f7';
        }
        if (circleSec) {
          const remaining = Math.max(0, (this.gesture.holdDurationMs - elapsed) / 1000).toFixed(1);
          circleSec.textContent = `${remaining}s`;
        }
        if (circleEmoji) {
          const emojis = { FIST: '✊', POINTING: '☝️', V_SIGN: '✌️', PALM: '✋' };
          circleEmoji.textContent = emojis[gestureName] || '🖐️';
        }

        if (elapsed >= this.gesture.holdDurationMs) {
          // Gesture Hold Complete! Transmit SOS immediately across all channels!
          console.log(`[Safety Pipeline] Gesture Hold Complete! Instant Dispatching: ${gestureName}`);

          const distressType = gestureName === 'FIST' ? 2 : (gestureName === 'POINTING' ? 1 : (gestureName === 'V_SIGN' ? 4 : 2));
          const defaultMsgs = {
            FIST: 'CAMERA GESTURE SOS: CLOSED FIST (TRAPPED)',
            POINTING: 'CAMERA GESTURE SOS: POINTING (MEDICAL)',
            V_SIGN: 'CAMERA GESTURE SOS: V-SIGN (EVAC / SHELTER)',
            PALM: 'CAMERA GESTURE SOS: OPEN PALM (DISTRESS)'
          };

          this.resetGestureHold();

          // Flash visual feedback on badge
          const badge = document.getElementById('gestureDetectedBadge');
          if (badge) {
            badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span><span class="text-emerald-300 font-bold">🚨 GESTURE SOS DISPATCHED TO RESCUE HQ!</span>`;
            badge.className = 'text-[11px] font-mono px-3 py-1 rounded-lg bg-emerald-950/90 text-emerald-200 border border-emerald-400 backdrop-blur-sm font-bold flex items-center gap-1.5 shadow-lg';
          }

          // Full visual flash overlay
          const flash = document.getElementById('hudSuccessFlash');
          if (flash) {
            flash.classList.remove('hidden');
            setTimeout(() => flash.classList.add('hidden'), 3200);
          }

          // Audio chime
          if (window.modem && typeof window.modem.playAlarmChime === 'function') {
            try { window.modem.playAlarmChime(); } catch (e) {}
          }

          // Execute dispatch
          if (typeof window.executePanicSosDispatch === 'function') {
            window.executePanicSosDispatch({
              source: 'gesture',
              gestureName: gestureName,
              distressType: distressType,
              message: defaultMsgs[gestureName] || 'CAMERA GESTURE SOS'
            });
          } else if (typeof GestureCamera._onTrigger === 'function') {
            GestureCamera._onTrigger(gestureName.toLowerCase());
          }
          return;
        }

        this.gesture.holdAnimFrameRef = requestAnimationFrame(checkProgress);
      };

      this.gesture.holdAnimFrameRef = requestAnimationFrame(checkProgress);
    },

    resetGestureHold() {
      this.gesture.isHolding = false;
      this.gesture.holdStartTime = null;
      this.gesture.currentDetectedGesture = null;

      if (this.gesture.holdAnimFrameRef) {
        cancelAnimationFrame(this.gesture.holdAnimFrameRef);
        this.gesture.holdAnimFrameRef = null;
      }
      if (this.gesture.graceTimeoutId) {
        clearTimeout(this.gesture.graceTimeoutId);
        this.gesture.graceTimeoutId = null;
      }

      const hud = document.getElementById('gestureHoldHud');
      const progressBar = document.getElementById('gestureHoldProgressBar');
      const percentText = document.getElementById('gestureHoldPercentText');
      const circleContainer = document.getElementById('hudHoldCountdownContainer');

      if (hud) {
        hud.classList.add('hidden');
        hud.style.display = 'none';
      }
      if (circleContainer) circleContainer.classList.add('hidden');
      if (progressBar) progressBar.style.width = '0%';
      if (percentText) percentText.textContent = '0%';
    },

    updateGestureBadge(gestureName) {
      const badge = document.getElementById('gestureDetectedBadge');
      if (!badge) return;

      if (!gestureName) {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-slate-500 animate-pulse"></span>
          <span>Waiting for Hand Sign...</span>
        `;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-black/70 text-slate-300 border border-white/20 backdrop-blur-sm font-bold flex items-center gap-1.5';
      } else if (gestureName === 'FIST') {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-red-400 animate-ping"></span>
          <span class="text-rose-300">✊ CLOSED FIST DETECTED // HOLD 1.2s</span>
        `;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-red-950/80 text-rose-200 border border-red-500/50 backdrop-blur-sm font-bold flex items-center gap-1.5';
      } else if (gestureName === 'POINTING') {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
          <span class="text-amber-300">☝️ POINTING INDEX DETECTED // HOLD 1.2s</span>
        `;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-amber-950/80 text-amber-200 border border-amber-500/50 backdrop-blur-sm font-bold flex items-center gap-1.5';
      } else if (gestureName === 'V_SIGN') {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-blue-400 animate-ping"></span>
          <span class="text-blue-300">✌️ V-SIGN DETECTED // HOLD 1.2s</span>
        `;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-blue-950/80 text-blue-200 border border-blue-500/50 backdrop-blur-sm font-bold flex items-center gap-1.5';
      } else if (gestureName === 'PALM') {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span class="text-emerald-300">✋ OPEN PALM DETECTED // HOLD 1.2s</span>
        `;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-200 border border-emerald-500/50 backdrop-blur-sm font-bold flex items-center gap-1.5';
      }
    },

    updatePillHighlights(gestureName) {
      const pillPalm = document.getElementById('gesturePillPalm');
      const pillFist = document.getElementById('gesturePillFist');
      const pillPoint = document.getElementById('gesturePillPoint');
      const pillV = document.getElementById('gesturePillV');

      const resetPill = (el) => {
        if (!el) return;
        el.className = 'p-1.5 rounded-xl border border-purple-200 bg-white text-purple-950 flex items-center justify-center gap-1 transition cursor-pointer hover:bg-purple-100';
      };

      const highlightPill = (el) => {
        if (!el) return;
        el.className = 'p-1.5 rounded-xl border-2 border-emerald-500 bg-emerald-100 text-emerald-950 font-black flex items-center justify-center gap-1 transition shadow-sm scale-105 cursor-pointer';
      };

      resetPill(pillPalm);
      resetPill(pillFist);
      resetPill(pillPoint);
      resetPill(pillV);

      if (gestureName === 'PALM') highlightPill(pillPalm);
      else if (gestureName === 'FIST') highlightPill(pillFist);
      else if (gestureName === 'POINTING') highlightPill(pillPoint);
      else if (gestureName === 'V_SIGN') highlightPill(pillV);
    }
  };

  // =========================================================================
  // 📷 GestureCamera Hardware & Canvas Vision Engine
  // =========================================================================
  let videoEl = null;
  let canvasOverlay = null;
  let ctxOverlay = null;
  let offscreenCanvas = null;
  let offscreenCtx = null;
  let stream = null;
  let isRunning = false;
  let isOpening = false;
  let currentFacingMode = 'user';
  let animationFrameId = null;
  let isUiBound = false;

  const GestureCamera = {
    _onTrigger: null,

    init(options = {}) {
      if (options.onTrigger) {
        this._onTrigger = options.onTrigger;
      }
      this.bindUi();
      console.log('📷 SilentBridge GestureCamera Engine Wired to SafetyPipeline.');
    },

    bindUi() {
      if (isUiBound) return;
      videoEl = document.getElementById('gestureVideo');
      canvasOverlay = document.getElementById('gestureCanvasOverlay');

      if (canvasOverlay) {
        ctxOverlay = canvasOverlay.getContext('2d');
      }

      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = 160;
      offscreenCanvas.height = 120;
      offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

      const btnToggle = document.getElementById('btnToggleGestureCamera');
      if (btnToggle && !btnToggle._hasGestureCameraListener) {
        btnToggle._hasGestureCameraListener = true;
        btnToggle.addEventListener('click', (e) => {
          e.preventDefault();
          this.toggle();
        });
      }

      const btnFlip = document.getElementById('btnFlipCamera');
      if (btnFlip && !btnFlip._hasGestureCameraListener) {
        btnFlip._hasGestureCameraListener = true;
        btnFlip.addEventListener('click', (e) => {
          e.preventDefault();
          this.flipCamera();
        });
      }

      isUiBound = true;
    },

    async start() {
      if (isRunning || isOpening) return;
      isOpening = true;

      this.bindUi();
      const btnToggle = document.getElementById('btnToggleGestureCamera');
      const wrapper = document.getElementById('gestureVideoWrapper');
      const hudStatus = document.getElementById('hudStatusBadge');

      if (btnToggle) {
        btnToggle.innerHTML = `<span>⏳</span> Opening Camera...`;
        btnToggle.classList.replace('bg-purple-600', 'bg-amber-600');
        btnToggle.classList.replace('hover:bg-purple-700', 'hover:bg-amber-700');
      }
      if (wrapper) {
        wrapper.classList.remove('hidden');
        wrapper.style.display = 'flex';
      }
      if (hudStatus) {
        hudStatus.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> REQUESTING CAMERA...`;
      }
      SafetyPipeline.updateGestureBadge(null);

      const hasMediaDevices = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      const legacyGetUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

      if (!hasMediaDevices && !legacyGetUserMedia) {
        const isSecure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        let errMsg = 'Camera access is not supported by this browser.';
        if (!isSecure) {
          errMsg = 'Camera requires a secure HTTPS connection. Please access https://silentbridge-i39k.vercel.app/';
        }
        alert(errMsg);
        this.resetUiToStopped();
        isOpening = false;
        return;
      }

      const requestStream = async (constraints) => {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          return await navigator.mediaDevices.getUserMedia(constraints);
        }
        return await new Promise((resolve, reject) => {
          legacyGetUserMedia.call(navigator, constraints, resolve, reject);
        });
      };

      try {
        let streamAcquired = null;
        let lastErr = null;

        // Tier 1: Ideal facingMode and dimensions
        try {
          streamAcquired = await requestStream({
            video: {
              facingMode: { ideal: currentFacingMode },
              width: { ideal: 640 },
              height: { ideal: 480 }
            },
            audio: false
          });
        } catch (e1) {
          lastErr = e1;
          console.warn('Tier 1 constraints failed, trying Tier 2:', e1);
        }

        // Tier 2: Basic dimensions
        if (!streamAcquired) {
          try {
            streamAcquired = await requestStream({
              video: { width: { ideal: 640 }, height: { ideal: 480 } },
              audio: false
            });
          } catch (e2) {
            lastErr = e2;
            console.warn('Tier 2 constraints failed, trying Tier 3:', e2);
          }
        }

        // Tier 3: Bare video constraint
        if (!streamAcquired) {
          try {
            streamAcquired = await requestStream({ video: true, audio: false });
          } catch (e3) {
            lastErr = e3;
          }
        }

        if (!streamAcquired) {
          throw lastErr || new Error('Could not access video source');
        }

        stream = streamAcquired;

        if (!videoEl) videoEl = document.getElementById('gestureVideo');
        if (videoEl) {
          videoEl.muted = true;
          videoEl.playsInline = true;
          videoEl.setAttribute('playsinline', '');
          videoEl.setAttribute('muted', '');
          videoEl.setAttribute('autoplay', '');
          videoEl.srcObject = stream;

          await new Promise((resolve) => {
            let done = false;
            const complete = () => {
              if (!done) {
                done = true;
                resolve();
              }
            };
            videoEl.onloadedmetadata = () => {
              videoEl.play().catch(e => console.warn('video.play note:', e)).finally(complete);
            };
            videoEl.onplaying = complete;
            videoEl.play().then(complete).catch(() => {});
            setTimeout(complete, 1200);
          });
        }

        isRunning = true;
        isOpening = false;
        this.updateUiState(true);

        const btnFlip = document.getElementById('btnFlipCamera');
        if (btnFlip) btnFlip.classList.remove('hidden');

        this.processFrame();

      } catch (err) {
        isOpening = false;
        console.error('Camera open error:', err);
        let errorMsg = 'Could not open camera: ' + (err.name || 'Error');
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMsg = 'Camera permission was denied. Please click the lock or camera icon in your browser address bar and select "Allow" camera access.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMsg = 'No camera hardware found on this system.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMsg = 'Camera is currently in use by another application or tab (e.g. Zoom, Teams, Meet). Please close other camera apps and try again.';
        } else if (err.name === 'OverconstrainedError') {
          errorMsg = 'Camera requested settings could not be satisfied. Please check your camera permissions.';
        } else if (err.message) {
          errorMsg += ` - ${err.message}`;
        }
        alert(errorMsg);
        this.resetUiToStopped();
      }
    },

    stop() {
      isRunning = false;
      isOpening = false;
      SafetyPipeline.cleanupAllTimers();
      SafetyPipeline.resetGestureHold();

      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (stream) {
        try {
          stream.getTracks().forEach(t => t.stop());
        } catch (e) {}
        stream = null;
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
      if (ctxOverlay && canvasOverlay) {
        ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
      }

      this.resetUiToStopped();

      const btnFlip = document.getElementById('btnFlipCamera');
      if (btnFlip) btnFlip.classList.add('hidden');
    },

    resetUiToStopped() {
      this.updateUiState(false);
    },

    toggle() {
      if (isRunning || isOpening) {
        this.stop();
      } else {
        this.start();
      }
    },

    async flipCamera() {
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
      if (isRunning) {
        this.stop();
        await this.start();
      }
    },

    updateUiState(active) {
      const btnToggle = document.getElementById('btnToggleGestureCamera');
      const wrapper = document.getElementById('gestureVideoWrapper');
      const hudStatus = document.getElementById('hudStatusBadge');

      if (btnToggle) {
        if (active) {
          btnToggle.innerHTML = `<span>🛑</span> Stop Gesture Camera`;
          btnToggle.className = 'flex-1 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-black text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-sm transition cursor-pointer';
        } else {
          btnToggle.innerHTML = `<span>📷</span> Open Gesture Camera`;
          btnToggle.className = 'flex-1 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white font-black text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-sm transition cursor-pointer';
        }
      }

      if (wrapper) {
        if (active) {
          wrapper.classList.remove('hidden');
          wrapper.style.display = 'flex';
        } else {
          wrapper.classList.add('hidden');
          wrapper.style.display = 'none';
        }
      }

      if (hudStatus) {
        hudStatus.innerHTML = active
          ? `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span> CAMERA ACTIVE`
          : `OFFLINE`;
      }

      if (!active) {
        SafetyPipeline.updateGestureBadge(null);
      }
    },

    processFrame() {
      if (!isRunning) return;

      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        if (canvasOverlay && (canvasOverlay.width !== videoEl.videoWidth || canvasOverlay.height !== videoEl.videoHeight)) {
          canvasOverlay.width = videoEl.videoWidth || 640;
          canvasOverlay.height = videoEl.videoHeight || 480;
        }

        this.detectHandFromCanvas();
      }

      animationFrameId = requestAnimationFrame(() => this.processFrame());
    },

    detectHandFromCanvas() {
      if (!videoEl || !offscreenCtx) return;

      const sw = offscreenCanvas.width;
      const sh = offscreenCanvas.height;
      offscreenCtx.drawImage(videoEl, 0, 0, sw, sh);
      const imgData = offscreenCtx.getImageData(0, 0, sw, sh);
      const pixels = imgData.data;

      let skinCount = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = sw, maxX = 0, minY = sh, maxY = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const sum = r + g + b;

        if (sum >= 70 && sum <= 735) {
          const rn = r / (sum + 0.001);
          const gn = g / (sum + 0.001);

          const yLum = 0.299 * r + 0.587 * g + 0.114 * b;
          const cr = (r - yLum) * 0.713 + 128;
          const cb = (b - yLum) * 0.564 + 128;

          const isChromSkin = (rn >= 0.33 && rn <= 0.64 && gn >= 0.23 && gn <= 0.40);
          const isYCrCbSkin = (cr >= 126 && cr <= 182 && cb >= 70 && cb <= 142);
          const isRgbSkin = (r > 70 && g > 35 && b > 20 && r > g && r > b && (Math.max(r, g, b) - Math.min(r, g, b) > 10));

          if ((isChromSkin && isYCrCbSkin) || (isRgbSkin && (isChromSkin || isYCrCbSkin))) {
            const px = (i / 4) % sw;
            const py = Math.floor((i / 4) / sw);

            skinCount++;
            sumX += px;
            sumY += py;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }

      const minPixels = sw * sh * 0.015;
      const maxPixels = sw * sh * 0.55;

      if (skinCount < minPixels || skinCount > maxPixels) {
        SafetyPipeline.onGestureDetected(null);
        if (ctxOverlay && canvasOverlay) {
          ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        }
        return;
      }

      const cx = sumX / skinCount;
      const cy = sumY / skinCount;
      const boxW = Math.max(1, maxX - minX);
      const boxH = Math.max(1, maxY - minY);

      const colStep = 2;
      const topProfile = [];

      for (let x = minX; x <= maxX; x += colStep) {
        let highestSkinY = sh;
        for (let y = minY; y <= cy + boxH * 0.15; y++) {
          const idx = (y * sw + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];
          const sum = r + g + b;
          if (sum >= 70 && sum <= 735) {
            const rn = r / (sum + 0.001);
            const gn = g / (sum + 0.001);
            const yLum = 0.299 * r + 0.587 * g + 0.114 * b;
            const cr = (r - yLum) * 0.713 + 128;
            const cb = (b - yLum) * 0.564 + 128;

            const isChromSkin = (rn >= 0.33 && rn <= 0.64 && gn >= 0.23 && gn <= 0.40);
            const isYCrCbSkin = (cr >= 126 && cr <= 182 && cb >= 70 && cb <= 142);
            const isRgbSkin = (r > 70 && g > 35 && b > 20 && r > g && r > b);

            if ((isChromSkin && isYCrCbSkin) || (isRgbSkin && (isChromSkin || isYCrCbSkin))) {
              highestSkinY = y;
              break;
            }
          }
        }
        topProfile.push({ x, y: highestSkinY });
      }

      const smoothedProfile = [];
      for (let i = 0; i < topProfile.length; i++) {
        const prev = topProfile[Math.max(0, i - 1)].y;
        const cur = topProfile[i].y;
        const next = topProfile[Math.min(topProfile.length - 1, i + 1)].y;
        smoothedProfile.push({ x: topProfile[i].x, y: (prev + cur * 2 + next) / 4 });
      }

      const peaks = [];
      const topThreshold = cy - boxH * 0.12;

      for (let i = 1; i < smoothedProfile.length - 1; i++) {
        const cur = smoothedProfile[i];
        const prev = smoothedProfile[i - 1];
        const next = smoothedProfile[i + 1];

        if (cur.y < topThreshold && cur.y <= prev.y && cur.y <= next.y) {
          const prominence = cy - cur.y;
          if (prominence > boxH * 0.18) {
            const isFar = peaks.every(p => Math.abs(p.x - cur.x) > boxW * 0.11);
            if (isFar) peaks.push(cur);
          }
        }
      }

      let detected = null;
      const numPeaks = peaks.length;
      const aspectRatio = boxW / boxH;

      if (numPeaks >= 3) {
        detected = 'PALM';
      } else if (numPeaks === 2) {
        detected = 'V_SIGN';
      } else if (numPeaks === 1) {
        detected = 'POINTING';
      } else if (numPeaks === 0) {
        if (aspectRatio >= 0.55 && aspectRatio <= 1.5) {
          detected = 'FIST';
        } else {
          detected = 'PALM';
        }
      }

      // Draw overlay
      if (ctxOverlay && canvasOverlay) {
        ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        const scaleX = canvasOverlay.width / sw;
        const scaleY = canvasOverlay.height / sh;

        ctxOverlay.save();
        ctxOverlay.strokeStyle = detected ? '#10b981' : '#a855f7';
        ctxOverlay.lineWidth = 3;
        ctxOverlay.strokeRect(minX * scaleX, minY * scaleY, boxW * scaleX, boxH * scaleY);

        ctxOverlay.fillStyle = '#ec4899';
        ctxOverlay.beginPath();
        ctxOverlay.arc(cx * scaleX, cy * scaleY, 7, 0, 2 * Math.PI);
        ctxOverlay.fill();

        peaks.forEach(p => {
          ctxOverlay.strokeStyle = '#10b981';
          ctxOverlay.lineWidth = 2.5;
          ctxOverlay.beginPath();
          ctxOverlay.moveTo(cx * scaleX, cy * scaleY);
          ctxOverlay.lineTo(p.x * scaleX, p.y * scaleY);
          ctxOverlay.stroke();

          ctxOverlay.fillStyle = '#10b981';
          ctxOverlay.beginPath();
          ctxOverlay.arc(p.x * scaleX, p.y * scaleY, 7, 0, 2 * Math.PI);
          ctxOverlay.fill();
        });
        ctxOverlay.restore();
      }

      SafetyPipeline.onGestureDetected(detected);
    },

    simulateGesture(gestureName) {
      const u = String(gestureName).toUpperCase();
      console.log(`🧪 Simulating SafetyPipeline hold for: ${u}`);

      const wrapper = document.getElementById('gestureVideoWrapper');
      if (wrapper && wrapper.classList.contains('hidden')) {
        wrapper.classList.remove('hidden');
        wrapper.style.display = 'flex';
      }

      SafetyPipeline.onGestureDetected(u);
    },

    applyConfirmedTheme(isConfirmed) {
      const container = document.getElementById('gestureCameraContainer');
      const title = document.getElementById('lblGestureTitle');
      const dot = document.getElementById('gestureCameraDot');
      const badge = document.getElementById('badgeGestureHold');
      const txt = document.getElementById('txtGestureInstruction');
      const btnToggle = document.getElementById('btnToggleGestureCamera');

      if (isConfirmed) {
        if (container) container.className = 'mb-4 p-4 bg-emerald-100/70 border-2 border-emerald-500 rounded-2xl shadow-sm transition-all';
        if (title) title.className = 'text-[11px] font-black text-emerald-950 tracking-wider flex items-center gap-1.5 font-mono';
        if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse';
        if (badge) {
          badge.className = 'text-[9px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-black font-mono uppercase tracking-wider';
          badge.innerText = '✓ RESCUE CONFIRMED';
        }
        if (txt) txt.className = 'text-[10px] text-emerald-900 mt-2 font-medium';
        if (btnToggle && !isRunning) {
          btnToggle.className = 'flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-sm transition active:scale-95 cursor-pointer';
        }
      } else {
        if (container) container.className = 'mb-4 p-4 bg-purple-50/70 border-2 border-purple-400 rounded-2xl shadow-sm transition-all';
        if (title) title.className = 'text-[11px] font-black text-purple-900 tracking-wider flex items-center gap-1.5 font-mono';
        if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-purple-600 animate-pulse';
        if (badge) {
          badge.className = 'text-[9px] bg-purple-200 text-purple-900 border border-purple-400 px-2 py-0.5 rounded-full font-black font-mono uppercase tracking-wider';
          badge.innerText = 'HOLD 1.2s TRIGGER';
        }
        if (txt) txt.className = 'text-[10px] text-slate-500 mt-2 font-medium';
        if (btnToggle && !isRunning) {
          btnToggle.className = 'flex-1 bg-purple-600 hover:bg-purple-700 text-white font-black text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-sm transition active:scale-95 cursor-pointer';
        }
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => GestureCamera.bindUi());
  } else {
    GestureCamera.bindUi();
  }

  window.SafetyPipeline = SafetyPipeline;
  window.GestureCamera = GestureCamera;
})(window);
