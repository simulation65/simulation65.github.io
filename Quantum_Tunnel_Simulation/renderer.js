/**
 * renderer.js — Canvas rendering for the Quantum Tunneling Simulator
 *
 * Draws:
 *  1. mainCanvas  — wave function Re(Ψ), Im(Ψ), |Ψ|², and potential barrier
 *  2. probCanvas  — |Ψ|² probability density (mini)
 *  3. potCanvas   — potential landscape (mini)
 */

'use strict';

window.QRenderer = (function () {

  // ── Resolved elements ────────────────────────────────────────────────────────
  let mainCanvas, probCanvas, potCanvas;
  let mCtx, pCtx, potCtx;

  // CSS variable cache
  const C = {
    bg:       '#060f18',
    bg2:      '#020b12',
    grid:     '#0d3352',
    waveRe:   '#00d4ff',
    waveIm:   '#ff6b35',
    waveProb: '#00ff99',
    barrier:  '#ffe066',
    text:     '#4a7a99',
    reflect:  '#ff4466',
    transmit: '#00ff99',
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function resize(canvas) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }
  }

  /** Map x (Å) → pixel x */
  function xToPixel(canvas, xVal) {
    return ((xVal - QSim.XMIN) / (QSim.XMAX - QSim.XMIN)) * canvas.width;
  }

  /** Map amplitude → pixel y (centred) */
  function ampToPixel(canvas, amp, scale) {
    return canvas.height / 2 - amp * scale;
  }

  // ── Grid / axes ──────────────────────────────────────────────────────────────
  function drawGrid(ctx, canvas) {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth   = 0.5;
    ctx.setLineDash([4, 8]);

    // Horizontal: centre line
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    // Vertical: every 5 Å
    for (let x = Math.ceil(QSim.XMIN / 5) * 5; x <= QSim.XMAX; x += 5) {
      const px = xToPixel(canvas, x);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, canvas.height);
      ctx.stroke();

      ctx.fillStyle = C.text;
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(x + 'Å', px + 3, canvas.height - 5);
    }

    ctx.setLineDash([]);
  }

  // ── Potential barrier ────────────────────────────────────────────────────────
  function drawBarrier(ctx, canvas, params) {
    if (!params || !params.barrierHeight) return;

    const { barrierHeight: V0, barrierWidth: d } = params;
    const x0 = -d / 2;
    const x1 =  d / 2;

    const px0 = xToPixel(canvas, x0);
    const px1 = xToPixel(canvas, x1);
    const scale = (canvas.height / 2) * 0.75 / Math.max(V0, 0.5);

    // Fill
    const grad = ctx.createLinearGradient(px0, 0, px1, 0);
    grad.addColorStop(0,   '#ffe06611');
    grad.addColorStop(0.5, '#ffe06622');
    grad.addColorStop(1,   '#ffe06611');
    ctx.fillStyle = grad;
    ctx.fillRect(px0, ampToPixel(canvas, V0 * scale, 1),
                 px1 - px0, V0 * scale);

    // Top edge
    ctx.strokeStyle = C.barrier;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px0, ampToPixel(canvas, V0 * scale, 1));
    ctx.lineTo(px1, ampToPixel(canvas, V0 * scale, 1));
    ctx.stroke();
    ctx.setLineDash([]);

    // Walls
    ctx.strokeStyle = '#ffe06688';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(px0, canvas.height / 2);
    ctx.lineTo(px0, ampToPixel(canvas, V0 * scale, 1));
    ctx.moveTo(px1, canvas.height / 2);
    ctx.lineTo(px1, ampToPixel(canvas, V0 * scale, 1));
    ctx.stroke();

    // Label
    ctx.fillStyle = C.barrier;
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('V₀', (px0 + px1) / 2, ampToPixel(canvas, V0 * scale, 1) - 6);
    ctx.textAlign = 'left';
  }

  // ── Wave function ────────────────────────────────────────────────────────────
  function drawWave(ctx, canvas) {
    const n      = QSim.N;
    const psiRe  = QSim.psiRe;
    const psiIm  = QSim.psiIm;
    const w      = canvas.width;
    const h      = canvas.height;
    const cy     = h / 2;
    const step   = Math.max(1, Math.floor(n / w));
    const scale  = (h / 2) * 0.85;

    // Find max for normalisation
    let maxAmp = 0;
    for (let i = 0; i < n; i += step) {
      const prob = Math.sqrt(psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]);
      if (prob > maxAmp) maxAmp = prob;
    }
    const norm = maxAmp > 0 ? scale / maxAmp : 1;

    // |Ψ|² filled area
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const px   = (i / n) * w;
      const prob = (psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]) * norm * norm / norm;
      if (i === 0) ctx.moveTo(px, cy - prob * norm * 0.5);
      else         ctx.lineTo(px, cy - prob * norm * 0.5);
    }
    ctx.lineTo(w, cy);
    ctx.lineTo(0, cy);
    ctx.closePath();
    const probGrad = ctx.createLinearGradient(0, 0, 0, h);
    probGrad.addColorStop(0, '#00ff9933');
    probGrad.addColorStop(1, '#00ff9905');
    ctx.fillStyle = probGrad;
    ctx.fill();

    // Re(Ψ)
    ctx.beginPath();
    ctx.strokeStyle = C.waveRe;
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = C.waveRe;
    ctx.shadowBlur  = 6;
    for (let i = 0; i < n; i += step) {
      const px = (i / n) * w;
      const py = cy - psiRe[i] * norm;
      if (i === 0) ctx.moveTo(px, py);
      else         ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Im(Ψ)
    ctx.beginPath();
    ctx.strokeStyle = C.waveIm;
    ctx.lineWidth   = 1;
    ctx.shadowColor = C.waveIm;
    ctx.shadowBlur  = 4;
    for (let i = 0; i < n; i += step) {
      const px = (i / n) * w;
      const py = cy - psiIm[i] * norm;
      if (i === 0) ctx.moveTo(px, py);
      else         ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Legend
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillStyle = C.waveRe;  ctx.fillText('Re(Ψ)', 8, 16);
    ctx.fillStyle = C.waveIm;  ctx.fillText('Im(Ψ)', 8, 30);
    ctx.fillStyle = C.waveProb; ctx.fillText('|Ψ|²',  8, 44);
  }

  // ── Probability density mini-canvas ─────────────────────────────────────────
  function drawProbDensity(ctx, canvas) {
    const n     = QSim.N;
    const w     = canvas.width;
    const h     = canvas.height;
    const step  = Math.max(1, Math.floor(n / w));
    let maxP    = 0;

    const pd = QSim.getProbDensity();
    for (let i = 0; i < n; i += step) if (pd[i] > maxP) maxP = pd[i];

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#020b12';
    ctx.fillRect(0, 0, w, h);

    if (maxP === 0) return;

    // Gradient fill under curve
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#00ff9944');
    grad.addColorStop(1, '#00ff9900');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < n; i += step) {
      const px = (i / n) * w;
      const py = h - (pd[i] / maxP) * (h * 0.9);
      ctx.lineTo(px, py);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Line
    ctx.strokeStyle = C.waveProb;
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = C.waveProb;
    ctx.shadowBlur  = 5;
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const px = (i / n) * w;
      const py = h - (pd[i] / maxP) * (h * 0.9);
      if (i === 0) ctx.moveTo(px, py);
      else         ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Barrier overlay
    if (QSim.params.barrierWidth) {
      const { barrierWidth: d } = QSim.params;
      const px0 = xToPixel(canvas, -d / 2);
      const px1 = xToPixel(canvas,  d / 2);
      ctx.fillStyle = '#ffe06618';
      ctx.fillRect(px0, 0, px1 - px0, h);
    }
  }

  // ── Potential landscape mini-canvas ─────────────────────────────────────────
  function drawPotential(ctx, canvas) {
    const n    = QSim.N;
    const V    = QSim.V;
    const w    = canvas.width;
    const h    = canvas.height;
    const step = Math.max(1, Math.floor(n / w));

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#020b12';
    ctx.fillRect(0, 0, w, h);

    // Find max positive V
    let maxV = 0;
    for (let i = 0; i < n; i += step) if (V[i] > maxV) maxV = V[i];
    if (maxV === 0) maxV = 1;

    // Baseline
    ctx.strokeStyle = C.grid;
    ctx.lineWidth   = 0.5;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.85);
    ctx.lineTo(w, h * 0.85);
    ctx.stroke();
    ctx.setLineDash([]);

    // Filled barrier
    ctx.strokeStyle = C.barrier;
    ctx.lineWidth   = 2;
    ctx.shadowColor = C.barrier;
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const px = (i / n) * w;
      const val = Math.max(V[i], 0);
      const py = h * 0.85 - (val / maxV) * (h * 0.7);
      if (i === 0) ctx.moveTo(px, py);
      else         ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // E label
    if (QSim.params.energy) {
      const E   = QSim.params.energy;
      const epy = h * 0.85 - (E / maxV) * (h * 0.7);
      ctx.strokeStyle = '#00d4ff88';
      ctx.lineWidth   = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, epy);
      ctx.lineTo(w, epy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#00d4ff';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText('E', 4, epy - 3);
    }
  }

  // ── Main render loop ─────────────────────────────────────────────────────────
  function render() {
    resize(mainCanvas);
    resize(probCanvas);
    resize(potCanvas);

    const w = mainCanvas.width;
    const h = mainCanvas.height;

    // Clear
    mCtx.fillStyle = C.bg;
    mCtx.fillRect(0, 0, w, h);

    drawGrid(mCtx, mainCanvas);
    drawBarrier(mCtx, mainCanvas, QSim.params);
    if (QSim.launched) drawWave(mCtx, mainCanvas);

    // Particle not yet launched — draw placeholder
    if (!QSim.launched) {
      mCtx.fillStyle = '#4a7a9966';
      mCtx.font = '13px Share Tech Mono, monospace';
      mCtx.textAlign = 'center';
      mCtx.fillText('Set parameters and click LAUNCH PARTICLE', w / 2, h / 2 + 4);
      mCtx.textAlign = 'left';
    }

    drawProbDensity(pCtx, probCanvas);
    drawPotential(potCtx, potCanvas);
  }

  // ── Public ───────────────────────────────────────────────────────────────────
  return {
    init() {
      mainCanvas = document.getElementById('mainCanvas');
      probCanvas = document.getElementById('probCanvas');
      potCanvas  = document.getElementById('potCanvas');
      mCtx   = mainCanvas.getContext('2d');
      pCtx   = probCanvas.getContext('2d');
      potCtx = potCanvas.getContext('2d');
      resize(mainCanvas);
      resize(probCanvas);
      resize(potCanvas);
    },

    render,
  };

})();
