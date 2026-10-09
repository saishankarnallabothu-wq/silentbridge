// gestureCamera.js - High-Precision Hands-Free Hand Sign SOS Camera (SilentBridge)
// 100% Offline Pure-JS Canvas Computer Vision.
// Detects ANY Hand Sign: ✋ Open Palm, ✊ Fist, ☝️ Pointing, ✌️ V-Sign, 👍 Thumbs Up, or 🖐️ Hand Sign.
// Holding any hand sign steadily for 1.5s automatically dispatches the emergency SOS to the receiver.

(function (window) {
  'use strict';

  const GESTURE_TYPES = {
    PALM: 'palm',
    FIST: 'fist',
    POINTING: 'pointing',
    V_SIGN: 'v_sign',
    THUMBS_UP: 'thumbs_up',
    HAND_SIGN: 'hand_sign'
  };

  const GESTURE_EMOJIS = {
    palm: '✋',
    fist: '✊',
    pointing: '☝️',
    v_sign: '✌️',
    thumbs_up: '👍',
    hand_sign: '🖐️'
  };

  const GESTURE_LABELS = {
    palm: 'OPEN PALM (HOLD 1.5s)',
    fist: 'CLOSED FIST (HOLD 1.5s)',
    pointing: 'POINTING (HOLD 1.5s)',
    v_sign: 'V-SIGN (HOLD 1.5s)',
    thumbs_up: 'THUMBS UP (HOLD 1.5s)',
    hand_sign: 'HAND SIGN (HOLD 1.5s)'
  };

  const REQUIRED_HOLD_MS = 1500;  // 1.5 seconds steady hold
  const GRACE_PERIOD_MS = 380;   // 380ms grace window to prevent micro-flicker resets
  const COOLDOWN_MS = 5000;       // 5 seconds cooldown after alert dispatch

  let videoEl = null;
  let canvasOverlay = null;
  let ctxOverlay = null;
  let offscreenCanvas = null;
  let offscreenCtx = null;
  let stream = null;
  let isRunning = false;
  let isOpening = false;
  let currentFacingMode = 'user'; // 'user' or 'environment'
  let animationFrameId = null;

  // Hand Tracking & Hold State
  let activeGesture = null;
  let gestureStartTime = 0;
  let lastDetectedTimestamp = 0;
  let isTriggerCooldown = false;
  let onSosTriggerCallback = null;
  let isUiBound = false;
  let simIntervalId = null;

  const GestureCamera = {
    init(options = {}) {
      if (options.onTrigger) {
        onSosTriggerCallback = options.onTrigger;
      }
      this.bindUi();
      console.log('📷 SilentBridge Hand Sign SOS Engine Initialized.');
    },

    bindUi() {
      if (isUiBound) return;
      videoEl = document.getElementById('gestureVideo');
      canvasOverlay = document.getElementById('gestureCanvasOverlay');

      if (canvasOverlay) {
        ctxOverlay = canvasOverlay.getContext('2d');
      }

      // Fast offscreen canvas for high-performance pixel-level computer vision
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = 160;
      offscreenCanvas.height = 120;
      offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

      // Setup UI Listeners
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
      const hudGesture = document.getElementById('hudDetectedGesture');

      // 1. Immediately provide visual feedback to user
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
      if (hudGesture) {
        hudGesture.innerText = 'STARTING SENSOR...';
      }

      // 2. Camera API Availability Check
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

        // Tier 1: Try with ideal facingMode and ideal resolution
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
          console.warn('Camera Tier 1 constraint failed, trying Tier 2:', e1);
        }

        // Tier 2: Try basic video constraints
        if (!streamAcquired) {
          try {
            streamAcquired = await requestStream({
              video: { width: { ideal: 640 }, height: { ideal: 480 } },
              audio: false
            });
          } catch (e2) {
            lastErr = e2;
            console.warn('Camera Tier 2 constraint failed, trying Tier 3:', e2);
          }
        }

        // Tier 3: Bare minimum video constraint
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

          // Ensure video playback starts reliably
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
            setTimeout(complete, 1200); // Safety fallback timeout
          });
        }

        isRunning = true;
        isOpening = false;
        this.updateUiState(true);

        const btnFlip = document.getElementById('btnFlipCamera');
        if (btnFlip) btnFlip.classList.remove('hidden');

        // Start real-time frame processing
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
          errorMsg = 'Camera is currently in use by another application or tab (e.g. Zoom, Teams, Google Meet). Please close other camera apps and try again.';
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
      if (simIntervalId) {
        clearInterval(simIntervalId);
        simIntervalId = null;
      }
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

      this.resetHoldState();
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
      const hudGesture = document.getElementById('hudDetectedGesture');

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

      if (hudGesture && !active) {
        hudGesture.innerText = 'SHOW HAND SIGN (✋/✊/☝️/✌️)';
      }
    },

    processFrame() {
      if (!isRunning) return;

      if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        if (canvasOverlay && (canvasOverlay.width !== videoEl.videoWidth || canvasOverlay.height !== videoEl.videoHeight)) {
          canvasOverlay.width = videoEl.videoWidth || 640;
          canvasOverlay.height = videoEl.videoHeight || 480;
        }

        // Run Pure-JS Canvas Computer Vision Hand Analyzer
        this.detectHandFromCanvas();
      }

      animationFrameId = requestAnimationFrame(() => this.processFrame());
    },

    // =========================================================================
    // 🧠 Pure-JS High-Precision Canvas Hand Sign Recognition Engine
    // =========================================================================
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

      // 1. Dual-Space Illumination-Invariant Skin Tone Filter
      // (Normalized RGB Chromaticity + YCrCb + RGB Contrast)
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

      // Check if minimum skin area is present (between 1.5% and 55% of frame)
      const minPixels = sw * sh * 0.015;
      const maxPixels = sw * sh * 0.55;

      if (skinCount < minPixels || skinCount > maxPixels) {
        this.handleGestureDetection(null, null);
        if (ctxOverlay && canvasOverlay) {
          ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        }
        return;
      }

      const cx = sumX / skinCount;
      const cy = sumY / skinCount;
      const boxW = Math.max(1, maxX - minX);
      const boxH = Math.max(1, maxY - minY);

      // 2. Scan Vertical Columns to Extract Upper Hand Silhouette
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

      // Smooth silhouette with 3-point moving average
      const smoothedProfile = [];
      for (let i = 0; i < topProfile.length; i++) {
        const prev = topProfile[Math.max(0, i - 1)].y;
        const cur = topProfile[i].y;
        const next = topProfile[Math.min(topProfile.length - 1, i + 1)].y;
        smoothedProfile.push({ x: topProfile[i].x, y: (prev + cur * 2 + next) / 4 });
      }

      // 3. Detect Protruding Finger Peaks
      const peaks = [];
      const topThreshold = cy - boxH * 0.12;

      for (let i = 1; i < smoothedProfile.length - 1; i++) {
        const cur = smoothedProfile[i];
        const prev = smoothedProfile[i - 1];
        const next = smoothedProfile[i + 1];

        // Local crest pointing upwards (cur.y is smaller than surrounding)
        if (cur.y < topThreshold && cur.y <= prev.y && cur.y <= next.y) {
          const prominence = cy - cur.y;
          if (prominence > boxH * 0.18) {
            const isFarFromOtherPeaks = peaks.every(p => Math.abs(p.x - cur.x) > boxW * 0.11);
            if (isFarFromOtherPeaks) {
              peaks.push(cur);
            }
          }
        }
      }

      // 4. Classify ANY Hand Sign
      let detected = null;
      const numPeaks = peaks.length;
      const aspectRatio = boxW / boxH;

      if (numPeaks >= 4) {
        // 4 or 5 extended fingers -> Open Palm / Stop Sign
        detected = GESTURE_TYPES.PALM;
      } else if (numPeaks === 3) {
        // 3 extended fingers -> Palm or Tri-Sign
        detected = GESTURE_TYPES.PALM;
      } else if (numPeaks === 2) {
        // 2 extended fingers -> V-Sign / Peace Sign
        detected = GESTURE_TYPES.V_SIGN;
      } else if (numPeaks === 1) {
        // 1 extended finger -> Pointing or Thumbs Up
        const peak = peaks[0];
        const isNearEdge = (peak.x - minX < boxW * 0.25) || (maxX - peak.x < boxW * 0.25);
        if (isNearEdge && aspectRatio > 0.8) {
          detected = GESTURE_TYPES.THUMBS_UP;
        } else {
          detected = GESTURE_TYPES.POINTING;
        }
      } else if (numPeaks === 0) {
        // No protruding fingers -> Fist (compact blob)
        if (aspectRatio >= 0.55 && aspectRatio <= 1.5) {
          detected = GESTURE_TYPES.FIST;
        } else {
          // General Hand Sign
          detected = GESTURE_TYPES.HAND_SIGN;
        }
      } else {
        detected = GESTURE_TYPES.HAND_SIGN;
      }

      // 5. Draw HUD Bounding Box, Skeleton & Finger Markers on Canvas
      if (ctxOverlay && canvasOverlay) {
        ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        const scaleX = canvasOverlay.width / sw;
        const scaleY = canvasOverlay.height / sh;

        const bx = minX * scaleX;
        const by = minY * scaleY;
        const bw = boxW * scaleX;
        const bh = boxH * scaleY;

        // Draw Bounding Box
        ctxOverlay.save();
        ctxOverlay.strokeStyle = detected ? '#10b981' : '#a855f7';
        ctxOverlay.lineWidth = 3;
        ctxOverlay.strokeRect(bx, by, bw, bh);

        // Draw Centroid / Palm Core
        ctxOverlay.fillStyle = '#ec4899';
        ctxOverlay.beginPath();
        ctxOverlay.arc(cx * scaleX, cy * scaleY, 7, 0, 2 * Math.PI);
        ctxOverlay.fill();

        // Draw Skeleton Lines and Finger Tips
        peaks.forEach(p => {
          ctxOverlay.strokeStyle = '#10b981';
          ctxOverlay.lineWidth = 2.5;
          ctxOverlay.beginPath();
          ctxOverlay.moveTo(cx * scaleX, cy * scaleY);
          ctxOverlay.lineTo(p.x * scaleX, p.y * scaleY);
          ctxOverlay.stroke();

          ctxOverlay.fillStyle = '#10b981';
          ctxOverlay.beginPath();
          ctxOverlay.arc(p.x * scaleX, p.y * scaleY, 8, 0, 2 * Math.PI);
          ctxOverlay.fill();

          ctxOverlay.fillStyle = '#ffffff';
          ctxOverlay.beginPath();
          ctxOverlay.arc(p.x * scaleX, p.y * scaleY, 3, 0, 2 * Math.PI);
          ctxOverlay.fill();
        });

        // Draw Label Tag above Bounding Box
        if (detected) {
          const labelText = `${GESTURE_EMOJIS[detected] || '🖐️'} ${detected.toUpperCase()}`;
          ctxOverlay.font = 'bold 14px monospace';
          const textW = ctxOverlay.measureText(labelText).width;
          const tagX = Math.max(10, bx + (bw - textW) / 2);
          const tagY = Math.max(24, by - 10);

          ctxOverlay.fillStyle = 'rgba(16, 185, 129, 0.9)';
          ctxOverlay.fillRect(tagX - 8, tagY - 18, textW + 16, 24);

          ctxOverlay.fillStyle = '#ffffff';
          ctxOverlay.fillText(labelText, tagX, tagY - 1);
        }
        ctxOverlay.restore();
      }

      this.handleGestureDetection(detected, { cx, cy, boxW, boxH, peaks });
    },

    // =========================================================================
    // ⏱️ 1.5-Second Continuous Steady Hold State Machine
    // =========================================================================
    handleGestureDetection(detected, handData) {
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
        const emoji = GESTURE_EMOJIS[detected] || '🖐️';

        if (hudGesture) {
          hudGesture.innerText = `${emoji} ${detected.toUpperCase()}`;
        }

        // Check if user is holding any valid hand sign
        if (activeGesture) {
          const elapsed = now - gestureStartTime;
          const progress = Math.min(1.0, elapsed / REQUIRED_HOLD_MS);
          const remainingSec = Math.max(0, (REQUIRED_HOLD_MS - elapsed) / 1000).toFixed(1);

          if (holdContainer) holdContainer.classList.remove('hidden');
          if (holdEmoji) holdEmoji.innerText = emoji;
          if (holdSeconds) holdSeconds.innerText = `${remainingSec}s`;
          if (holdLabel) holdLabel.innerText = `HOLD ${detected.toUpperCase()} (1.5s TO SEND SOS)`;

          if (svgRing) {
            const circumference = 188.5; // 2 * PI * r (30)
            const offset = circumference * (1 - progress);
            svgRing.style.strokeDashoffset = offset;
            svgRing.style.stroke = progress > 0.75 ? '#10b981' : '#a855f7';
          }

          if (elapsed >= REQUIRED_HOLD_MS) {
            // 🎯 TRIGGER CRITICAL EMERGENCY SOS TRANSMISSION
            this.triggerEmergencySos(detected);
          }
        } else {
          // Started holding a hand sign
          activeGesture = detected;
          gestureStartTime = now;
          if (holdContainer) holdContainer.classList.remove('hidden');
          if (svgRing) svgRing.style.strokeDashoffset = '188.5';
        }
      } else {
        // Grace period (380ms) to withstand momentary camera blur or frame drop
        if (activeGesture && (now - lastDetectedTimestamp > GRACE_PERIOD_MS)) {
          this.resetHoldState();
          if (hudGesture) hudGesture.innerText = 'SHOW HAND SIGN (✋/✊/☝️/✌️)';
        }
      }
    },

    // Instant Simulation / Interactive One-Tap Test
    simulateGesture(gesture) {
      if (isTriggerCooldown) return;

      const wrapper = document.getElementById('gestureVideoWrapper');
      if (wrapper && wrapper.classList.contains('hidden')) {
        wrapper.classList.remove('hidden');
        wrapper.style.display = 'flex';
      }

      if (simIntervalId) {
        clearInterval(simIntervalId);
        simIntervalId = null;
      }

      console.log(`🧪 Interactive test for hand sign: ${gesture}`);
      let simStart = performance.now();
      this.resetHoldState();

      simIntervalId = setInterval(() => {
        const now = performance.now();
        const elapsed = now - simStart;
        this.handleGestureDetection(gesture, null);

        if (elapsed >= REQUIRED_HOLD_MS + 200 || isTriggerCooldown) {
          clearInterval(simIntervalId);
          simIntervalId = null;
        }
      }, 50);
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

      if (detected === GESTURE_TYPES.PALM) highlightPill(pillPalm);
      else if (detected === GESTURE_TYPES.FIST) highlightPill(pillFist);
      else if (detected === GESTURE_TYPES.POINTING || detected === GESTURE_TYPES.THUMBS_UP) highlightPill(pillPoint);
      else if (detected === GESTURE_TYPES.V_SIGN) highlightPill(pillV);
      else if (detected === GESTURE_TYPES.HAND_SIGN) {
        highlightPill(pillPalm);
      }
    },

    // =========================================================================
    // 🚨 Emergency Alert Trigger
    // =========================================================================
    triggerEmergencySos(gesture) {
      isTriggerCooldown = true;
      this.resetHoldState();

      console.log(`🚨 HAND SIGN EMERGENCY SOS TRIGGERED: [${gesture.toUpperCase()}] held for 1.5s!`);

      // 1. Success Visual Flash
      const flash = document.getElementById('hudSuccessFlash');
      if (flash) {
        flash.classList.remove('hidden');
        setTimeout(() => flash.classList.add('hidden'), 3200);
      }

      // 2. Play acoustic confirmation chime
      if (window.modem && typeof window.modem.playAlarmChime === 'function') {
        try { window.modem.playAlarmChime(); } catch (e) {}
      }

      // 3. Dispatch SOS to application (publishes MQTT & acoustic broadcast to Rescuer)
      if (typeof onSosTriggerCallback === 'function') {
        onSosTriggerCallback(gesture);
      }

      // 4. Cooldown timer to prevent accidental double-triggers
      setTimeout(() => {
        isTriggerCooldown = false;
        console.log('Gesture camera trigger cooldown expired. Ready for next hand sign.');
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
          btnToggle.className = 'flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-sm transition active:scale-95 cursor-pointer';
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
          btnToggle.className = 'flex-1 bg-purple-600 hover:bg-purple-700 text-white font-black text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-sm transition active:scale-95 cursor-pointer';
        }
      }
    }
  };

  // Auto-bind UI as soon as DOM is ready so clicks work immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => GestureCamera.bindUi());
  } else {
    GestureCamera.bindUi();
  }

  window.GestureCamera = GestureCamera;
})(window);
