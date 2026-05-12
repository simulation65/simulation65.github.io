/**
 * ui.js — UI controller for Quantum Tunneling Simulator
 *
 * Manages:
 *  - Slider inputs and display
 *  - Simulation loop (requestAnimationFrame)
 *  - Stats panel updates (T, R, κ, k, λ, v)
 *  - Event log
 *  - Launch / Reset buttons
 */

'use strict';

(function () {

  // ── State ────────────────────────────────────────────────────────────────────
  let animId      = null;
  let lastTime    = null;
  let stepsPerSec = 1000;        // physics steps per second
  let barrierReached  = false;
  let transmitted     = false;
  let reflected       = false;

  // ── Slider config ────────────────────────────────────────────────────────────
  const sliders = [
    { id: 'energy',         valId: 'energy-val',         fixed: 2 },
    { id: 'barrier-height', valId: 'barrier-height-val', fixed: 2 },
    { id: 'barrier-width',  valId: 'barrier-width-val',  fixed: 1 },
    { id: 'mass',           valId: 'mass-val',           fixed: 2 },
    { id: 'sigma',          valId: 'sigma-val',          fixed: 1 },
    { id: 'speed',          valId: 'speed-val',          fixed: 1 },
  ];

  function getParams() {
    return {
      energy:        +document.getElementById('energy').value,
      barrierHeight: +document.getElementById('barrier-height').value,
      barrierWidth:  +document.getElementById('barrier-width').value,
      mass:          +document.getElementById('mass').value,
      sigma:         +document.getElementById('sigma').value,
    };
  }

  function getSpeed() {
    return +document.getElementById('speed').value;
  }

  // ── Stats updater ────────────────────────────────────────────────────────────
  function updateStats() {
    const p = QSim.params;
    if (!p || !p.energy) return;

    const { T, R } = QSim.computeProbabilities();
    const Tpct = (T * 100).toFixed(1) + '%';
    const Rpct = (R * 100).toFixed(1) + '%';

    document.getElementById('val-T').textContent = Tpct;
    document.getElementById('val-R').textContent = Rpct;
    document.getElementById('fill-T').style.width = (T * 100) + '%';
    document.getElementById('fill-R').style.width = (R * 100) + '%';

    document.getElementById('ro-kappa').textContent =
      p.kappa > 0 ? p.kappa.toFixed(3) : 'N/A (E>V₀)';
    document.getElementById('ro-k').textContent  = p.k0.toFixed(3);
    document.getElementById('ro-lambda').textContent = p.lambda.toFixed(3);
    document.getElementById('ro-v').textContent  = (p.vGroup / 1e6 * 9.578e14).toFixed(3);

    document.getElementById('time-display').textContent =
      't = ' + QSim.t.toFixed(3) + ' ℏ/eV';

    // Event detection
    if (!barrierReached && p.barrierWidth) {
      // Check if wave has reached the barrier (x ≈ -d/2)
      const psiRe = QSim.psiRe;
      const N     = QSim.N;
      const idxBarLeft = Math.round((-p.barrierWidth / 2 - QSim.XMIN) / QSim.DX);
      let ampAtBarrier = 0;
      for (let i = idxBarLeft - 5; i <= idxBarLeft + 5; i++) {
        if (i < 0 || i >= N) continue;
        ampAtBarrier += psiRe[i] * psiRe[i];
      }
      if (ampAtBarrier > 0.02) {
        barrierReached = true;
        logEvent('⚡ Wave packet hit barrier', true);
        logEvent('  Analytical T = ' + (p.analyticalT * 100).toFixed(2) + '%', false);
        if (p.energy < p.barrierHeight) {
          logEvent('  Tunneling regime (E < V₀)', true);
        } else {
          logEvent('  Above-barrier regime (E ≥ V₀)', false);
        }
      }
    }

    if (barrierReached && !transmitted && T > 0.02) {
      transmitted = true;
      logEvent('→ Transmission detected: ' + Tpct, true);
    }

    if (barrierReached && !reflected && R < 0.98 && T > 0.01) {
      reflected = true;
      logEvent('← Reflected packet: ' + Rpct, false);
    }
  }

  // ── Event log ────────────────────────────────────────────────────────────────
  function logEvent(msg, highlight) {
    const log = document.getElementById('event-log');
    const entry = document.createElement('div');
    entry.className = 'log-entry' + (highlight ? ' highlight' : '');
    const t = QSim.t.toFixed(3);
    entry.textContent = '[' + t + '] ' + msg;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  function clearLog() {
    const log = document.getElementById('event-log');
    while (log.children.length > 1) log.removeChild(log.lastChild);
  }

  // ── Analytical readout ───────────────────────────────────────────────────────
  function updateAnalytical() {
    const p = getParams();
    const T = QSim.analyticalT(p.energy, p.barrierHeight, p.barrierWidth, p.mass);
    // Show pre-launch analytical values
    document.getElementById('val-T').textContent = (T * 100).toFixed(1) + '%';
    document.getElementById('val-R').textContent = ((1 - T) * 100).toFixed(1) + '%';
    document.getElementById('fill-T').style.width = (T * 100) + '%';
    document.getElementById('fill-R').style.width = ((1 - T) * 100) + '%';

    const HBAR2_2M = 3.81 / p.mass;
    const k0 = Math.sqrt(p.energy / HBAR2_2M);
    const kappa = p.energy < p.barrierHeight
      ? Math.sqrt((p.barrierHeight - p.energy) / HBAR2_2M) : 0;
    document.getElementById('ro-kappa').textContent =
      kappa > 0 ? kappa.toFixed(3) : 'N/A';
    document.getElementById('ro-k').textContent  = k0.toFixed(3);
    document.getElementById('ro-lambda').textContent = ((2 * Math.PI) / k0).toFixed(3);
    document.getElementById('ro-v').textContent  = (2 * HBAR2_2M * k0 / 1e6 * 9.578e14).toFixed(3);
  }

  // ── Animation loop ───────────────────────────────────────────────────────────
  function loop(ts) {
    if (!QSim.running) return;

    if (lastTime === null) lastTime = ts;
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;

    const speed = getSpeed();
    const nSteps = Math.round(stepsPerSec * dt * speed);
    QSim.advance(Math.min(nSteps, 200));

    updateStats();
    QRenderer.render();

    animId = requestAnimationFrame(loop);
  }

  // ── Button handlers ──────────────────────────────────────────────────────────
  function launch() {
    if (animId) cancelAnimationFrame(animId);
    lastTime = null;
    barrierReached = false;
    transmitted    = false;
    reflected      = false;
    clearLog();

    const p = getParams();
    QSim.init(p);
    QSim.setRunning(true);
    logEvent('Particle launched', false);
    logEvent('E = ' + p.energy.toFixed(2) + ' eV  V₀ = ' + p.barrierHeight.toFixed(2) + ' eV', false);

    animId = requestAnimationFrame(loop);
  }

  function reset() {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    const p = getParams();
    QSim.init(p);
    QSim.setRunning(false);
    clearLog();
    barrierReached = false;
    transmitted    = false;
    reflected      = false;
    updateAnalytical();
    QRenderer.render();
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    QRenderer.init();

    // Sliders
    sliders.forEach(({ id, valId, fixed }) => {
      const el  = document.getElementById(id);
      const val = document.getElementById(valId);
      val.textContent = parseFloat(el.value).toFixed(fixed);
      el.addEventListener('input', () => {
        val.textContent = parseFloat(el.value).toFixed(fixed);
        if (!QSim.running) {
          updateAnalytical();
          QRenderer.render();
        }
      });
    });

    // Buttons
    document.getElementById('btn-launch').addEventListener('click', launch);
    document.getElementById('btn-reset').addEventListener('click', reset);

    // Initial state
    const p = getParams();
    QSim.init(p);
    updateAnalytical();
    QRenderer.render();

    // Resize handler
    window.addEventListener('resize', () => {
      QRenderer.render();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

})();
