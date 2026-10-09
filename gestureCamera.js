// gestureCamera.js - Hands-Free Emergency Gesture SOS Trigger (SilentBridge)
// Detects ✊ Fist, ☝️ Pointing, or ✌️ V-Sign held continuously for 1.5 seconds.
// Dual-Engine: MediaPipe Hands with built-in 100% offline Pure-JS Canvas Computer Vision.

(function (window) {
  'use strict';

  const GESTURE_TYPES = {
    FIST: 'fist',
    POINTING: 'pointing',
    V_SIGN: 'v_sign'
  };

  const GESTURE_EMOJIS = {
    fist: '✊',
    pointing: '☝️',
    v_sign: '✌️'
  };

  const GESTURE_LABELS = {
    fist: 'FIST (HOLD 1.5s)',
    pointing: 'POINTING (HOLD 1.5s)',
    v_sign: 'V-SIGN (HOLD 1.5s)'
  };

  const REQUIRED_HOLD_MS = 1500; // 1.5 seconds hold threshold
  const COOLDOWN_MS = 6000;      // 6 seconds cooldown after dispatch

  let videoEl = null;
  let canvasOverlay = null;
  let ctxOverlay = null;
  let offscreenCanvas = null;
  let offscreenCtx = null;
  let stream = null;
  let isRunning = false;
  let currentFacingMode = 'user'; // 'user' or 'environment'
  let animationFrameId = null;

  // Gesture Tracking State
  let activeGesture = null;
  let gestureStartTime = 0;
  let lastDetectedTimestamp = 0;
  let isTriggerCooldown = false;
  let onSosTriggerCallback = null;

  // MediaPipe Hands Instance (if CDN loads)
  let mpHands = null;
  let isMpReady = false;

  const GestureCamera = {
    init(options = {}) {
      onSosTriggerCallback = options.onTrigger || null;
      videoEl = document.getElementById('gestureVideo');
      canvasOverlay = document.getElementById('gestureCanvasOverlay');

      if (canvasOverlay) {
        ctxOverlay = canvasOverlay.getContext('2d');
      }

      // Offscreen canvas for fast native pixel computer vision
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = 160;
      offscreenCanvas.height = 120;
      offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

      // Initialize MediaPipe Hands gracefully if available
      this.initMediaPipe();

      // Setup UI Listeners
      const btnToggle = document.getElementById('btnToggleGestureCamera');
      if (btnToggle) {
        btnToggle.addEventListener('click', () => this.toggle());
      }

      const btnFlip = document.getElementById('btnFlipCamera');
      if (btnFlip) {
        btnFlip.addEventListener('click', () => this.flipCamera());
      }
    },

    initMediaPipe() {
      if (typeof window.Hands !== 'undefined') {
        try {
          mpHands = new window.Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
          });
          mpHands.setOptions({
            maxNumHands: 1,
            modelComplexity: 0, // 0 for ultra-fast performance on mobile
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
          });
          mpHands.onResults((results) => this.handleMediaPipeResults(results));
          isMpReady = true;
          console.log('🤖 MediaPipe Hands engine initialized.');
        } catch (e) {
          console.warn('MediaPipe init note, using native Canvas Vision:', e);
          isMpReady = false;
        }
      }
    },

    async start() {
      if (isRunning) return;
      try {
        const constraints = {
          video: {
            facingMode: currentFacingMode,
            width: { ideal: 640 },
            height: { ideal: 480 }
          },
          audio: false
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!videoEl) videoEl = document.getElementById('gestureVideo');
        if (videoEl) {
          videoEl.srcObject = stream;
          await videoEl.play();
        }

        isRunning = true;
        this.updateUiState(true);

        const btnFlip = document.getElementById('btnFlipCamera');
        if (btnFlip) btnFlip.classList.remove('hidden');

        // Start processing loop
        this.processFrame();
      } catch (err) {
        console.error('Gesture camera start error:', err);
        alert('Could not open camera for gesture detection: ' + (err.message || 'Permission denied'));
        this.updateUiState(false);
      }
    },

    stop() {
      isRunning = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
      if (ctxOverlay && canvasOverlay) {
        ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
      }

      this.resetHoldState();
      this.updateUiState(false);

      const btnFlip = document.getElementById('btnFlipCamera');
      if (btnFlip) btnFlip.classList.add('hidden');
    },

    toggle() {
      if (isRunning) {
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
          btnToggle.classList.replace('bg-purple-600', 'bg-red-600');
          btnToggle.classList.replace('hover:bg-purple-700', 'hover:bg-red-700');
        } else {
          btnToggle.innerHTML = `<span>📷</span> Open Gesture Camera`;
          btnToggle.classList.replace('bg-red-600', 'bg-purple-600');
          btnToggle.classList.replace('hover:bg-red-700', 'hover:bg-purple-700');
        }
      }

      if (wrapper) {
        if (active) wrapper.classList.remove('hidden');
        else wrapper.classList.add('hidden');
      }

      if (hudStatus) {
        hudStatus.innerHTML = active
          ? `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span> CAMERA ACTIVE`
          : `OFFLINE`;
      }
    },

    processFrame() {
      if (!isRunning) return;

      if (videoEl && videoEl.readyState >= 2) {
        if (canvasOverlay && (canvasOverlay.width !== videoEl.videoWidth || canvasOverlay.height !== videoEl.videoHeight)) {
          canvasOverlay.width = videoEl.videoWidth || 640;
          canvasOverlay.height = videoEl.videoHeight || 480;
        }

        if (isMpReady && mpHands) {
          try {
            mpHands.send({ image: videoEl }).catch(() => {
              this.fallbackNativeVision();
            });
          } catch (e) {
            this.fallbackNativeVision();
          }
        } else {
          this.fallbackNativeVision();
        }
      }

      animationFrameId = requestAnimationFrame(() => this.processFrame());
    },

    // 1. Built-in Pure-JS Canvas Computer Vision Hand & Finger Analyzer
    // 100% Offline with zero external dependencies.
    fallbackNativeVision() {
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

      // YCrCb Skin Tone Segmentation
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const cr = (r - y) * 0.713 + 128;
        const cb = (b - y) * 0.564 + 128;

        if (cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127 && r > 65 && g > 40) {
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

      // Check if enough skin mass is present (at least 2.5% of frame)
      const minPixels = sw * sh * 0.025;
      if (skinCount < minPixels) {
        this.handleGestureDetection(null);
        if (ctxOverlay && canvasOverlay) {
          ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        }
        return;
      }

      const cx = sumX / skinCount;
      const cy = sumY / skinCount;
      const boxW = maxX - minX;
      const boxH = maxY - minY;

      // Analyze finger peaks extending above centroid (y < cy)
      const topCutoff = cy - boxH * 0.05;
      const colStep = 4;
      const topProfile = [];

      for (let x = minX; x <= maxX; x += colStep) {
        let highestSkinY = sh;
        for (let y = minY; y <= cy; y++) {
          const idx = (y * sw + x) * 4;
          const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
          const yVal = 0.299 * r + 0.587 * g + 0.114 * b;
          const cr = (r - yVal) * 0.713 + 128;
          const cb = (b - yVal) * 0.564 + 128;

          if (cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127) {
            highestSkinY = y;
            break;
          }
        }
        topProfile.push({ x, y: highestSkinY });
      }

      // Count peaks that protrude upwards significantly
      const peaks = [];
      for (let i = 1; i < topProfile.length - 1; i++) {
        const cur = topProfile[i];
        const prev = topProfile[i - 1];
        const next = topProfile[i + 1];

        if (cur.y < topCutoff && cur.y <= prev.y && cur.y <= next.y) {
          // Significant prominence
          const prominence = cy - cur.y;
          if (prominence > boxH * 0.35) {
            const isFarFromExisting = peaks.every(p => Math.abs(p.x - cur.x) > boxW * 0.18);
            if (isFarFromExisting) {
              peaks.push(cur);
            }
          }
        }
      }

      // Gesture Classification:
      let detected = null;
      if (peaks.length === 0) {
        // Compact blob with no fingers sticking out -> Fist
        const aspectRatio = boxW / Math.max(1, boxH);
        if (aspectRatio > 0.6 && aspectRatio < 1.4) {
          detected = GESTURE_TYPES.FIST;
        }
      } else if (peaks.length === 1) {
        // Single extended finger -> Pointing
        detected = GESTURE_TYPES.POINTING;
      } else if (peaks.length === 2) {
        // Two extended fingers with gap -> V-Sign
        detected = GESTURE_TYPES.V_SIGN;
      }

      // Render Visual Skeleton / Bounding Box on Canvas Overlay
      if (ctxOverlay && canvasOverlay) {
        ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        const scaleX = canvasOverlay.width / sw;
        const scaleY = canvasOverlay.height / sh;

        ctxOverlay.strokeStyle = detected ? '#10b981' : '#a855f7';
        ctxOverlay.lineWidth = 3;
        ctxOverlay.strokeRect(minX * scaleX, minY * scaleY, boxW * scaleX, boxH * scaleY);

        // Draw centroid
        ctxOverlay.fillStyle = '#ec4899';
        ctxOverlay.beginPath();
        ctxOverlay.arc(cx * scaleX, cy * scaleY, 6, 0, 2 * Math.PI);
        ctxOverlay.fill();

        // Draw detected finger peaks
        peaks.forEach(p => {
          ctxOverlay.fillStyle = '#10b981';
          ctxOverlay.beginPath();
          ctxOverlay.arc(p.x * scaleX, p.y * scaleY, 8, 0, 2 * Math.PI);
          ctxOverlay.fill();
        });
      }

      this.handleGestureDetection(detected);
    },

    // 2. MediaPipe Hands Landmark Parser (When CDN is ready)
    handleMediaPipeResults(results) {
      if (!ctxOverlay || !canvasOverlay) return;
      ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

      if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        this.handleGestureDetection(null);
        return;
      }

      const landmarks = results.multiHandLandmarks[0];
      const w = canvasOverlay.width;
      const h = canvasOverlay.height;

      // Finger Extension States (landmarks y-axis: 0 is top, 1 is bottom)
      const isIndexExtended = landmarks[8].y < landmarks[6].y;
      const isMiddleExtended = landmarks[12].y < landmarks[10].y;
      const isRingExtended = landmarks[16].y < landmarks[14].y;
      const isPinkyExtended = landmarks[20].y < landmarks[18].y;

      let detected = null;
      if (!isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        detected = GESTURE_TYPES.FIST;
      } else if (isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        detected = GESTURE_TYPES.POINTING;
      } else if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        const fingerDist = Math.hypot(landmarks[8].x - landmarks[12].x, landmarks[8].y - landmarks[12].y);
        if (fingerDist > 0.035) {
          detected = GESTURE_TYPES.V_SIGN;
        }
      }

      // Draw skeleton lines
      ctxOverlay.lineWidth = 3;
      ctxOverlay.strokeStyle = detected ? '#10b981' : '#a855f7';

      const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [0, 9], [9, 10], [10, 11], [11, 12], // Middle
        [0, 13], [13, 14], [14, 15], [15, 16], // Ring
        [0, 17], [17, 18], [18, 19], [19, 20] // Pinky
      ];

      connections.forEach(([p1, p2]) => {
        ctxOverlay.beginPath();
        ctxOverlay.moveTo(landmarks[p1].x * w, landmarks[p1].y * h);
        ctxOverlay.lineTo(landmarks[p2].x * w, landmarks[p2].y * h);
        ctxOverlay.stroke();
      });

      // Draw Joint points
      landmarks.forEach((pt, index) => {
        ctxOverlay.fillStyle = [4, 8, 12, 16, 20].includes(index) ? '#10b981' : '#f43f5e';
        ctxOverlay.beginPath();
        ctxOverlay.arc(pt.x * w, pt.y * h, [4, 8, 12, 16, 20].includes(index) ? 6 : 4, 0, 2 * Math.PI);
        ctxOverlay.fill();
      });

      this.handleGestureDetection(detected);
    },

    // 3. Centralized 1.5s Continuous Hold State Machine
    handleGestureDetection(detected) {
      const now = performance.now();
      const hudGesture = document.getElementById('hudDetectedGesture');
      const holdContainer = document.getElementById('hudHoldCountdownContainer');
      const svgRing = document.getElementById('hudHoldSvgRing');
      const holdSeconds = document.getElementById('hudHoldSecondsText');
      const holdEmoji = document.getElementById('hudHoldEmoji');
      const holdLabel = document.getElementById('hudHoldLabel');

      this.updatePillHighlights(detected);

      if (isTriggerCooldown) {
        if (hudGesture) hudGesture.innerText = 'COOLDOWN // DISPATCHED';
        if (holdContainer) holdContainer.classList.add('hidden');
        return;
      }

      if (detected) {
        lastDetectedTimestamp = now;
        if (hudGesture) {
          hudGesture.innerText = `${GESTURE_EMOJIS[detected]} ${detected.toUpperCase()}`;
        }

        if (activeGesture === detected) {
          // Continues holding the same gesture
          const elapsed = now - gestureStartTime;
          const progress = Math.min(1.0, elapsed / REQUIRED_HOLD_MS);
          const remainingSec = Math.max(0, (REQUIRED_HOLD_MS - elapsed) / 1000).toFixed(1);

          if (holdContainer) holdContainer.classList.remove('hidden');
          if (holdEmoji) holdEmoji.innerText = GESTURE_EMOJIS[detected];
          if (holdSeconds) holdSeconds.innerText = `${remainingSec}s`;
          if (holdLabel) holdLabel.innerText = `HOLD ${detected.toUpperCase()} STEADY`;

          if (svgRing) {
            const circumference = 188.5; // 2 * PI * r (30)
            const offset = circumference * (1 - progress);
            svgRing.style.strokeDashoffset = offset;
            svgRing.style.stroke = progress > 0.8 ? '#10b981' : '#a855f7';
          }

          if (elapsed >= REQUIRED_HOLD_MS) {
            // 🎯 TRIGGER CRITICAL EMERGENCY SOS
            this.triggerEmergencySos(detected);
          }
        } else {
          // New gesture detected, start fresh 1.5s timer
          activeGesture = detected;
          gestureStartTime = now;
          if (holdContainer) holdContainer.classList.remove('hidden');
          if (svgRing) svgRing.style.strokeDashoffset = '188.5';
        }
      } else {
        // Small 250ms hysteresis buffer to prevent jitter
        if (activeGesture && now - lastDetectedTimestamp > 250) {
          this.resetHoldState();
          if (hudGesture) hudGesture.innerText = 'SHOW ✊ / ☝️ / ✌️';
        }
      }
    },

    resetHoldState() {
      activeGesture = null;
      gestureStartTime = 0;
      const holdContainer = document.getElementById('hudHoldCountdownContainer');
      const svgRing = document.getElementById('hudHoldSvgRing');
      if (holdContainer) holdContainer.classList.add('hidden');
      if (svgRing) svgRing.style.strokeDashoffset = '188.5';
      this.updatePillHighlights(null);
    },

    updatePillHighlights(detected) {
      const pillFist = document.getElementById('gesturePillFist');
      const pillPoint = document.getElementById('gesturePillPoint');
      const pillV = document.getElementById('gesturePillV');

      const resetPill = (el) => {
        if (!el) return;
        el.className = 'p-1.5 rounded-xl border border-purple-200 bg-white text-purple-950 flex items-center justify-center gap-1 transition';
      };

      const highlightPill = (el) => {
        if (!el) return;
        el.className = 'p-1.5 rounded-xl border-2 border-emerald-500 bg-emerald-100 text-emerald-950 font-black flex items-center justify-center gap-1 transition shadow-sm scale-105';
      };

      resetPill(pillFist);
      resetPill(pillPoint);
      resetPill(pillV);

      if (detected === GESTURE_TYPES.FIST) highlightPill(pillFist);
      else if (detected === GESTURE_TYPES.POINTING) highlightPill(pillPoint);
      else if (detected === GESTURE_TYPES.V_SIGN) highlightPill(pillV);
    },

    triggerEmergencySos(gesture) {
      isTriggerCooldown = true;
      this.resetHoldState();

      console.log(`🚨 HANDS-FREE GESTURE SOS TRIGGERED: [${gesture.toUpperCase()}] held for 1.5s!`);

      // 1. Success Visual Flash
      const flash = document.getElementById('hudSuccessFlash');
      if (flash) {
        flash.classList.remove('hidden');
        setTimeout(() => flash.classList.add('hidden'), 2800);
      }

      // 2. Play acoustic confirmation chime
      if (window.modem && typeof window.modem.playAlarmChime === 'function') {
        try { window.modem.playAlarmChime(); } catch (e) {}
      }

      // 3. Dispatch callback to application
      if (typeof onSosTriggerCallback === 'function') {
        onSosTriggerCallback(gesture);
      }

      // 4. Cooldown timer to prevent accidental double-triggers
      setTimeout(() => {
        isTriggerCooldown = false;
        console.log('Gesture camera trigger cooldown expired. Ready for next gesture.');
      }, COOLDOWN_MS);
    },

    // Apply Green Theme when ACK arrives from Rescuer
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
          btnToggle.className = 'flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-sm transition active:scale-95';
        }
      } else {
        if (container) container.className = 'mb-4 p-4 bg-purple-50/70 border-2 border-purple-400 rounded-2xl shadow-sm transition-all';
        if (title) title.className = 'text-[11px] font-black text-purple-900 tracking-wider flex items-center gap-1.5 font-mono';
        if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-purple-600 animate-pulse';
        if (badge) {
          badge.className = 'text-[9px] bg-purple-200 text-purple-900 border border-purple-400 px-2 py-0.5 rounded-full font-black font-mono uppercase tracking-wider';
          badge.innerText = 'HOLD 1.5s TRIGGER';
        }
        if (txt) txt.className = 'text-[10px] text-slate-500 mt-2 font-medium';
        if (btnToggle && !isRunning) {
          btnToggle.className = 'flex-1 bg-purple-600 hover:bg-purple-700 text-white font-black text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-sm transition active:scale-95';
        }
      }
    }
  };

  window.GestureCamera = GestureCamera;
})(window);
