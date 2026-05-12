/**
 * physics.js — Quantum Tunneling Physics Engine
 *
 * Simulates a 1D Gaussian wave packet incident on a finite square potential
 * barrier using the split-operator method (FFT-based time evolution).
 *
 * Units:  Energy in eV · Length in Å · ℏ = 1 (scaled units)
 * Physical constants are converted so the simulation space maps naturally.
 */

'use strict';

// ─── Physical constants (simulation units) ───────────────────────────────────
// We work in "natural" atomic units scaled to eV and Å:
//   ℏ²/(2mₑ) = 3.81 eV·Å²  →  so kinetic energy k² · 3.81 eV·Å²
const HBAR2_OVER_2ME = 3.81;   // eV·Å²  (ℏ²/2mₑ)

// ─── Grid / simulation parameters ─────────────────────────────────────────────
const N    = 1024;           // grid points (must be power of 2 for FFT)
const XMIN = -30;            // Å
const XMAX =  30;            // Å
const DX   = (XMAX - XMIN) / N;

// Momentum grid (conjugate to position via FFT)
// Frequencies: k = 2π·n / (N·Δx)
const DK   = (2 * Math.PI) / (N * DX);

// ─── State object ─────────────────────────────────────────────────────────────
window.QSim = (function () {

  // Wave function: stored as two Float64Arrays (real, imag)
  let psiRe = new Float64Array(N);
  let psiIm = new Float64Array(N);

  // Pre-computed propagators
  let expVRe = new Float64Array(N);   // real part of exp(-i V(x) Δt/2ℏ)
  let expVIm = new Float64Array(N);   // imag part

  let expKRe = new Float64Array(N);   // real part of exp(-i k² Δt / 2m·2ℏ)
  let expKIm = new Float64Array(N);

  // Potential array
  let V = new Float64Array(N);

  // Public state
  let t = 0;
  let params = {};
  let running = false;
  let launched = false;

  // ── FFT (Cooley-Tukey, in-place, radix-2) ───────────────────────────────────
  function fft(re, im, inverse) {
    const n = re.length;
    // Bit-reverse permutation
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    // FFT butterfly
    const sign = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const ang = sign * 2 * Math.PI / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        for (let k = 0; k < len / 2; k++) {
          const uRe = re[i + k], uIm = im[i + k];
          const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
          const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
          re[i + k]           = uRe + vRe;
          im[i + k]           = uIm + vIm;
          re[i + k + len / 2] = uRe - vRe;
          im[i + k + len / 2] = uIm - vIm;
          const newRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = newRe;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }

  // ── Build potential ──────────────────────────────────────────────────────────
  function buildPotential(V0, d, xCenter) {
    // xCenter: centre of barrier (default 0)
    const half = d / 2;
    const x0 = (xCenter || 0) - half;
    const x1 = (xCenter || 0) + half;
    for (let i = 0; i < N; i++) {
      const x = XMIN + i * DX;
      V[i] = (x >= x0 && x <= x1) ? V0 : 0;
    }
    // Absorbing boundary layers (imaginary potential) to prevent reflections from walls
    const absWidth = Math.floor(N * 0.08);
    const absStrength = 0.5; // eV-equivalent
    for (let i = 0; i < absWidth; i++) {
      const s = Math.pow((absWidth - i) / absWidth, 2) * absStrength;
      V[i]         -= s; // negative → absorbing (imaginary part trick via separate channel)
      V[N - 1 - i] -= s;
    }
  }

  // ── Build half-step potential propagator exp(-i V Δt / 2ℏ) ──────────────────
  function buildVPropagator(dt) {
    for (let i = 0; i < N; i++) {
      const angle = -V[i] * dt / 2;  // ℏ = 1
      expVRe[i] = Math.cos(angle);
      expVIm[i] = Math.sin(angle);
    }
  }

  // ── Build full-step kinetic propagator exp(-i k² Δt / (2m)) ─────────────────
  // Momentum ordering: k[i] = i·Δk for i<N/2, (i-N)·Δk for i>=N/2
  function buildKPropagator(dt, mass) {
    const scale = HBAR2_OVER_2ME / mass; // ℏ²/(2m) in eV·Å²
    for (let i = 0; i < N; i++) {
      const ki = i < N / 2 ? i * DK : (i - N) * DK;
      const angle = -scale * ki * ki * dt;
      expKRe[i] = Math.cos(angle);
      expKIm[i] = Math.sin(angle);
    }
  }

  // ── Initialise Gaussian wave packet ─────────────────────────────────────────
  function initWavePacket(x0, k0, sigma) {
    // ψ(x) = (2πσ²)^{-1/4} exp(-(x-x0)²/4σ²) exp(ik0 x)
    const norm = Math.pow(2 * Math.PI * sigma * sigma, -0.25);
    let sumNorm = 0;
    for (let i = 0; i < N; i++) {
      const x = XMIN + i * DX;
      const gauss = norm * Math.exp(-Math.pow(x - x0, 2) / (4 * sigma * sigma));
      psiRe[i] = gauss * Math.cos(k0 * x);
      psiIm[i] = gauss * Math.sin(k0 * x);
      sumNorm += psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i];
    }
    // Normalise
    const inv = 1 / Math.sqrt(sumNorm * DX);
    for (let i = 0; i < N; i++) {
      psiRe[i] *= inv;
      psiIm[i] *= inv;
    }
  }

  // ── Split-operator time step ─────────────────────────────────────────────────
  // Algorithm: exp(-iHΔt) ≈ exp(-iVΔt/2) · exp(-iTΔt) · exp(-iVΔt/2)
  function step(nSteps) {
    for (let s = 0; s < nSteps; s++) {

      // 1. Half-step V
      for (let i = 0; i < N; i++) {
        const r = psiRe[i], im = psiIm[i];
        psiRe[i] = r * expVRe[i] - im * expVIm[i];
        psiIm[i] = r * expVIm[i] + im * expVRe[i];
      }

      // 2. Full-step T via FFT
      fft(psiRe, psiIm, false);
      for (let i = 0; i < N; i++) {
        const r = psiRe[i], im = psiIm[i];
        psiRe[i] = r * expKRe[i] - im * expKIm[i];
        psiIm[i] = r * expKIm[i] + im * expKRe[i];
      }
      fft(psiRe, psiIm, true);

      // 3. Half-step V
      for (let i = 0; i < N; i++) {
        const r = psiRe[i], im = psiIm[i];
        psiRe[i] = r * expVRe[i] - im * expVIm[i];
        psiIm[i] = r * expVIm[i] + im * expVRe[i];
      }
    }
  }

  // ── Compute probabilities (transmission / reflection) ───────────────────────
  function computeProbabilities(barrierRight) {
    let T = 0, R = 0;
    const brIdx = Math.round((barrierRight - XMIN) / DX);
    for (let i = 0; i < N; i++) {
      const prob = (psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]) * DX;
      if (i > brIdx) T += prob;
      else           R += prob;
    }
    return { T, R };
  }

  // ── Analytical transmission coefficient ─────────────────────────────────────
  function analyticalT(E, V0, d, mass) {
    if (E >= V0) {
      // Above barrier — oscillatory
      const k1 = Math.sqrt(E / (HBAR2_OVER_2ME / mass));
      const k2 = Math.sqrt((E - V0) / (HBAR2_OVER_2ME / mass));
      const kd = k2 * d;
      const denom = 1 + Math.pow((k1 * k1 - k2 * k2) * Math.sin(kd) / (2 * k1 * k2), 2);
      return 1 / denom;
    } else {
      // Under barrier — tunneling
      const kappa = Math.sqrt((V0 - E) / (HBAR2_OVER_2ME / mass));
      const sinh2 = Math.pow(Math.sinh(kappa * d), 2);
      const denom = 1 + (V0 * V0 * sinh2) / (4 * E * (V0 - E));
      return 1 / denom;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  return {
    N, XMIN, XMAX, DX, DK,

    get psiRe()  { return psiRe; },
    get psiIm()  { return psiIm; },
    get V()      { return V; },
    get t()      { return t; },
    get running(){ return running; },
    get launched(){ return launched; },
    get params() { return params; },

    /**
     * Initialise (or re-initialise) the simulation.
     * @param {Object} p - Parameters from UI
     */
    init(p) {
      params = { ...p };
      t = 0;
      running = false;
      launched = false;

      const E   = p.energy;        // eV
      const V0  = p.barrierHeight; // eV
      const d   = p.barrierWidth;  // Å
      const m   = p.mass;          // mₑ
      const sig = p.sigma;         // Å

      // Wave packet starts well to the left of barrier
      const x0 = -10;  // Å
      const k0  = Math.sqrt(E / (HBAR2_OVER_2ME / m));  // Å⁻¹

      buildPotential(V0, d, 0);
      initWavePacket(x0, k0, sig);

      // Time step: small enough for stability, ~0.005 ℏ/eV
      params.dt   = 0.005;
      params.k0   = k0;
      params.kappa = E < V0 ? Math.sqrt((V0 - E) / (HBAR2_OVER_2ME / m)) : 0;
      params.lambda = (2 * Math.PI) / k0;
      params.vGroup = 2 * (HBAR2_OVER_2ME / m) * k0;  // Å·eV/ℏ → Å/time_unit

      buildVPropagator(params.dt);
      buildKPropagator(params.dt, m);

      params.analyticalT = analyticalT(E, V0, d, m);
      params.barrierRight = d / 2;
    },

    /**
     * Advance simulation by a number of steps.
     */
    advance(nSteps) {
      if (!running) return;
      step(nSteps);
      t += params.dt * nSteps;
    },

    setRunning(val) { running = val; launched = launched || val; },

    computeProbabilities() {
      return computeProbabilities(params.barrierRight);
    },

    /** Get |Ψ(x)|² array (allocates; call sparingly) */
    getProbDensity() {
      const pd = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        pd[i] = psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i];
      }
      return pd;
    },

    analyticalT,
  };

})();
