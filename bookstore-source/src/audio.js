/**
 * Procedural WebAudio ambience for the cozy bookstore.
 *
 * Everything is synthesized at runtime - no audio files, no three.js.
 *
 * Layers:
 *   - warm room bed (brown/pink loop: body + air, slow swell)
 *   - very quiet detuned A/E pad
 *   - fireplace: ember rumble + scheduled crackles / ember thumps
 *   - window rain (窗外微雨): right-hand-side hiss bed + scheduled droplets,
 *     with a 20-40 s gust envelope
 *   - focus bed: heavily low-passed "room hush" white noise
 *   - one-shot foley: page lift + page whoosh, book open/close
 *
 * Master volume and the rain/noise switches persist in localStorage, but the
 * audio engine still only ever starts from a user gesture. When WebAudio is
 * unavailable the whole module silently degrades to no-ops.
 */

const STORAGE_KEY = 'cozy-bookstore-audio';

const DEFAULT_VOLUME = 0.55;
const DEFAULT_RAIN_LEVEL = 0.4;
const DEFAULT_NOISE_LEVEL = 0.3;

const MASTER_FADE_IN = 1.8;
const MASTER_FADE_OUT = 0.8;
const PAD_FADE_IN = 2.4;
const PAD_FADE_OUT = 0.7;

/** Rain / hush layers always fade in and out over ~0.6 s (click-free). */
const LAYER_FADE = 0.6;

const FIRE_GAP_MIN = 600;
const FIRE_GAP_MAX = 2400;

/** Rain sits under the fireplace: bed gain, pan and gust timing. */
const RAIN_PAN = 0.32;
const RAIN_BED_GAIN = 0.085;
const RAIN_GUST_MIN = 20;
const RAIN_GUST_MAX = 40;

/** The focus "room hush" is darker still, so it reads as air, not hiss. */
const NOISE_BED_GAIN = 0.11;

const PEAK_FLOOR = 0.0001;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => clamp(value, 0, 1);
const rand = (min, max) => min + Math.random() * (max - min);

/** Pick a usable AudioContext constructor, or null when unsupported. */
function getAudioContextConstructor() {
  const scope = typeof window !== 'undefined' ? window : globalThis;
  if (!scope) return null;
  return scope.AudioContext || scope.webkitAudioContext || null;
}

/* ------------------------------------------------------------------ */
/*  Buffer synthesis                                                   */
/* ------------------------------------------------------------------ */

/**
 * Fill one channel with a soft brown/pink mix. Brown noise supplies the
 * low "room weight"; pink noise keeps it from sounding like a rumble only.
 */
function fillWarmChannel(data) {
  let brown = 0;
  // Paul Kellet's economical pink-noise filter.
  let p0 = 0;
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let p4 = 0;
  let p5 = 0;
  let p6 = 0;

  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;

    // Leaky integrator: brown-ish without drifting too far.
    brown = brown * 0.997 + white * 0.018;

    p0 = 0.99886 * p0 + white * 0.0555179;
    p1 = 0.99332 * p1 + white * 0.0750759;
    p2 = 0.969 * p2 + white * 0.153852;
    p3 = 0.8665 * p3 + white * 0.3104856;
    p4 = 0.55 * p4 + white * 0.5329522;
    p5 = -0.7616 * p5 - white * 0.016898;
    const pink = (p0 + p1 + p2 + p3 + p4 + p5 + p6 + white * 0.5362) * 0.11;
    p6 = white * 0.115926;

    const sample = brown * 2.4 + pink * 0.75;
    data[i] = clamp(sample, -1.4, 1.4);
  }
}

/**
 * A long, seamlessly loopable stereo room tone.
 *
 * The final `fadeFrames` samples of a longer generation are crossfaded over
 * the first samples, so the loop point is continuous instead of clicking.
 */
function buildWarmNoiseBuffer(audioCtx) {
  const sampleRate = audioCtx.sampleRate || 44100;
  const seconds = 8.5;
  const frames = Math.floor(sampleRate * seconds);
  const fadeFrames = Math.min(Math.floor(sampleRate * 0.7), Math.floor(frames / 4));
  const rawFrames = frames + fadeFrames;

  const buffer = audioCtx.createBuffer(2, frames, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const rawLeft = new Float32Array(rawFrames);
  const rawRight = new Float32Array(rawFrames);
  fillWarmChannel(rawLeft);
  fillWarmChannel(rawRight);

  let peak = 0;
  for (let i = 0; i < frames; i++) {
    let l = rawLeft[i];
    let r = rawRight[i];

    if (i < fadeFrames) {
      // At i = 0 the tail (which follows the last sample) dominates; at the
      // end of the fade we are back on the head waveform.
      const t = i / fadeFrames;
      const head = Math.sin(t * Math.PI * 0.5);
      const tail = Math.cos(t * Math.PI * 0.5);
      l = rawLeft[i] * head + rawLeft[frames + i] * tail;
      r = rawRight[i] * head + rawRight[frames + i] * tail;
    }

    // Slightly narrow stereo: a room should feel intimate, not wide/hissy.
    const mid = (l + r) * 0.5;
    l = mid + (l - mid) * 0.68;
    r = mid + (r - mid) * 0.68;

    left[i] = l;
    right[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }

  if (peak > 0.0001) {
    const scale = 0.82 / peak;
    for (let i = 0; i < frames; i++) {
      left[i] *= scale;
      right[i] *= scale;
    }
  }

  return buffer;
}

/** Short mono white-noise source used by every transient sound. */
function buildWhiteNoiseBuffer(audioCtx) {
  const sampleRate = audioCtx.sampleRate || 44100;
  const frames = Math.floor(sampleRate * 2.2);
  const buffer = audioCtx.createBuffer(1, frames, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Render a seamlessly loopable buffer of `channels` channels.
 *
 * `fillChannel` writes the raw (head + tail) material; the last `fadeFrames`
 * samples are then cosine-crossfaded over the head so the loop point is
 * continuous instead of clicking.
 */
function buildLoopingBuffer(audioCtx, seconds, channels, fillChannel) {
  const sampleRate = audioCtx.sampleRate || 44100;
  const frames = Math.max(1, Math.floor(sampleRate * seconds));
  const fadeFrames = Math.min(Math.floor(sampleRate * 0.6), Math.floor(frames / 4));
  const rawFrames = frames + fadeFrames;

  const buffer = audioCtx.createBuffer(channels, frames, sampleRate);
  const outputs = [];
  const raws = [];
  for (let c = 0; c < channels; c++) {
    outputs.push(buffer.getChannelData(c));
    const raw = new Float32Array(rawFrames);
    fillChannel(raw);
    raws.push(raw);
  }

  let peak = 0;
  for (let c = 0; c < channels; c++) {
    const out = outputs[c];
    const raw = raws[c];
    for (let i = 0; i < frames; i++) {
      let value = raw[i];
      if (i < fadeFrames) {
        const t = i / fadeFrames;
        value =
          raw[i] * Math.sin(t * Math.PI * 0.5) +
          raw[frames + i] * Math.cos(t * Math.PI * 0.5);
      }
      out[i] = value;
      peak = Math.max(peak, Math.abs(value));
    }
  }

  if (peak > 0.0001) {
    const scale = 0.8 / peak;
    for (let c = 0; c < channels; c++) {
      const out = outputs[c];
      for (let i = 0; i < frames; i++) out[i] *= scale;
    }
  }

  return buffer;
}

/**
 * Rain bed material: white noise softened by one leaky integrator, so the
 * 400 Hz - 7 kHz band-pass that follows sounds like spray, not static.
 */
function fillRainChannel(data) {
  let soft = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    soft = soft * 0.42 + white * 0.58;
    data[i] = soft * 0.9 + white * 0.18;
  }
}

/** Focus-bed material: pink/brown weighted, it is low-passed to a whisper. */
function fillHushChannel(data) {
  let brown = 0;
  let pink = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    brown = brown * 0.995 + white * 0.02;
    pink = pink * 0.72 + white * 0.28;
    data[i] = brown * 1.5 + pink * 0.3;
  }
}

function buildRainBuffer(audioCtx) {
  return buildLoopingBuffer(audioCtx, 6.5, 2, fillRainChannel);
}

function buildHushBuffer(audioCtx) {
  return buildLoopingBuffer(audioCtx, 6, 1, fillHushChannel);
}

/* ------------------------------------------------------------------ */
/*  Persistence (never a user gesture substitute)                      */
/* ------------------------------------------------------------------ */

function readStoredSettings() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    // Private mode, disabled storage or corrupted JSON: just use defaults.
    return null;
  }
}

function writeStoredSettings(payload) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* storage can be unavailable or full; audio must keep working */
  }
}

/* ------------------------------------------------------------------ */
/*  Small node helpers                                                 */
/* ------------------------------------------------------------------ */

function createFilter(audioCtx, type, frequency, q) {
  const filter = audioCtx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  if (typeof q === 'number') filter.Q.value = q;
  return filter;
}

function createPanner(audioCtx, pan) {
  if (typeof audioCtx.createStereoPanner === 'function') {
    const panner = audioCtx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    return panner;
  }
  // Mono fallback: a unity gain node keeps the chain valid.
  return audioCtx.createGain();
}

/** Gentle safety limiter; keeps overlapping foley from ever clipping. */
function createLimiter(audioCtx) {
  if (typeof audioCtx.createDynamicsCompressor !== 'function') return null;
  try {
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 14;
    limiter.ratio.value = 3;
    limiter.attack.value = 0.006;
    limiter.release.value = 0.22;
    return limiter;
  } catch {
    return null;
  }
}

/** Fast-attack / slow-decay envelope with a non-zero exponential floor. */
function createDecayEnvelope(audioCtx, when, peak, attack, end) {
  const envelope = audioCtx.createGain();
  const safePeak = Math.max(PEAK_FLOOR, peak);
  const attackEnd = when + Math.max(0.0015, attack);
  const endTime = when + Math.max(attack + 0.004, end);
  envelope.gain.setValueAtTime(PEAK_FLOOR, when);
  envelope.gain.exponentialRampToValueAtTime(safePeak, attackEnd);
  envelope.gain.exponentialRampToValueAtTime(PEAK_FLOOR, endTime);
  return envelope;
}

/** Disconnect a finished one-shot's little node chain so GC can take it. */
function releaseAfter(source, nodes) {
  source.onended = () => {
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        /* already gone */
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Public factory                                                     */
/* ------------------------------------------------------------------ */

export function createAmbience() {
  const AudioCtor = getAudioContextConstructor();

  let ctx = null;
  let graphReady = false;
  let master = null;
  let limiter = null;
  let ambienceBus = null;
  let padBus = null;
  let fireBus = null;
  let rainLevel = null;
  let rainPan = null;
  let rainBedWander = null;
  let rainLowpass = null;
  let noiseLevel = null;
  let hushBody = null;
  let hushLowpass = null;
  let roomBuffer = null;
  let whiteBuffer = null;
  let rainBuffer = null;
  let hushBuffer = null;

  let enabled = false;
  let fireOn = false;
  let announced = false;

  // Persistent-ish user state. Restored on construction, applied on enable().
  let volume = DEFAULT_VOLUME;
  let rainOn = false;
  let rainAmount = DEFAULT_RAIN_LEVEL;
  let noiseOn = false;
  let noiseAmount = DEFAULT_NOISE_LEVEL;
  let persistedSnapshot = '';

  const stored = readStoredSettings();
  if (stored) {
    if (typeof stored.volume === 'number' && Number.isFinite(stored.volume)) {
      volume = clamp01(stored.volume);
    }
    if (typeof stored.rain === 'boolean') rainOn = stored.rain;
    if (typeof stored.noise === 'boolean') noiseOn = stored.noise;
  }

  let fireTimer = 0;
  let rainTimer = 0;
  let suspendTimer = 0;
  let controlEpoch = 0;
  let enablePromise = null;

  // Phase reference for the analytic rain-gust estimate (droplet density).
  let rainGustPeriod = RAIN_GUST_MIN;
  let rainGustEpoch = 0;

  let visibilityBound = false;
  let pageHidden =
    typeof document !== 'undefined' &&
    (document.visibilityState === 'hidden' || document.hidden === true);

  // Keeps fade ramps smooth if the user toggles quickly mid-transition.
  const paramFades = new WeakMap();

  /* ---------------- graph construction ---------------- */

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = 0;

    limiter = createLimiter(ctx);
    if (limiter) {
      master.connect(limiter);
      limiter.connect(ctx.destination);
    } else {
      master.connect(ctx.destination);
    }

    ambienceBus = ctx.createGain();
    ambienceBus.gain.value = 1;
    ambienceBus.connect(master);

    fireBus = ctx.createGain();
    fireBus.gain.value = 0;
    fireBus.connect(master);

    /* --- warm room bed: one long loop fanned into body + air --- */
    const roomSource = ctx.createBufferSource();
    roomSource.buffer = roomBuffer;
    roomSource.loop = true;

    const bodyHigh = createFilter(ctx, 'highpass', 38, 0.5);
    const bodyLow = createFilter(ctx, 'lowpass', 470, 0.35);
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.17;
    roomSource.connect(bodyHigh);
    bodyHigh.connect(bodyLow);
    bodyLow.connect(bodyGain);
    bodyGain.connect(ambienceBus);

    const airHigh = createFilter(ctx, 'highpass', 850, 0.5);
    const airLow = createFilter(ctx, 'lowpass', 2400, 0.3);
    const airGain = ctx.createGain();
    airGain.gain.value = 0.012;
    roomSource.connect(airHigh);
    airHigh.connect(airLow);
    airLow.connect(airGain);
    airGain.connect(ambienceBus);

    // A very slow swell keeps the bed from feeling like a static loop.
    const roomLfo = ctx.createOscillator();
    roomLfo.type = 'sine';
    roomLfo.frequency.value = 0.023;
    const roomLfoDepth = ctx.createGain();
    roomLfoDepth.gain.value = 0.012;
    roomLfo.connect(roomLfoDepth);
    roomLfoDepth.connect(bodyGain.gain);

    roomSource.start();
    roomLfo.start();

    /* --- warm A/E pad, three slightly detuned sines --- */
    padBus = ctx.createGain();
    padBus.gain.value = 0;
    const padLow = createFilter(ctx, 'lowpass', 1200, 0.2);
    padBus.connect(padLow);
    padLow.connect(ambienceBus);

    const voices = [
      { frequency: 110.0, level: 0.0105, pan: -0.22, lfoRate: 0.043, detuneDepth: 1.6 },
      { frequency: 164.81, level: 0.0072, pan: 0.1, lfoRate: 0.067, detuneDepth: 1.1 },
      { frequency: 220.0, level: 0.005, pan: 0.3, lfoRate: 0.031, detuneDepth: 1.9 },
    ];

    for (const voice of voices) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = voice.frequency;
      osc.detune.value = rand(-1.4, 1.4);

      const voiceGain = ctx.createGain();
      voiceGain.gain.value = voice.level;
      const panner = createPanner(ctx, voice.pan);

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = voice.lfoRate;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = voice.detuneDepth;
      lfo.connect(lfoDepth);
      lfoDepth.connect(osc.detune);

      osc.connect(voiceGain);
      voiceGain.connect(panner);
      panner.connect(padBus);

      osc.start();
      lfo.start();
    }

    /* --- fireplace: continuous ember rumble, crackles added later --- */
    const emberSource = ctx.createBufferSource();
    emberSource.buffer = roomBuffer;
    emberSource.loop = true;
    const emberLow = createFilter(ctx, 'lowpass', 150, 0.5);
    const emberGain = ctx.createGain();
    emberGain.gain.value = 0.019;
    emberSource.connect(emberLow);
    emberLow.connect(emberGain);
    emberGain.connect(fireBus);

    emberSource.start(0, rand(0, 2));

    /* --- window rain: right-hand hiss bed + scheduled droplets --- */
    rainLevel = ctx.createGain();
    rainLevel.gain.value = 0;
    rainLevel.connect(master);

    const rainSource = ctx.createBufferSource();
    rainSource.buffer = rainBuffer;
    rainSource.loop = true;

    const rainHighpass = createFilter(ctx, 'highpass', 400, 0.5);
    rainLowpass = createFilter(ctx, 'lowpass', 7000, 0.35);
    const rainBedGain = ctx.createGain();
    rainBedGain.gain.value = RAIN_BED_GAIN;
    rainBedWander = ctx.createGain();
    rainBedWander.gain.value = 0.82;
    // The layer sits slightly to the right of the room (a window nearby).
    rainPan = createPanner(ctx, RAIN_PAN);

    rainSource.connect(rainHighpass);
    rainHighpass.connect(rainLowpass);
    rainLowpass.connect(rainBedGain);
    rainBedGain.connect(rainBedWander);
    rainBedWander.connect(rainPan);
    rainPan.connect(rainLevel);

    // One slow LFO for two jobs: the low-pass cutoff drifts, and a very
    // gentle amplitude wander rides on top of it (no extra oscillator).
    const rainCutoffLfo = ctx.createOscillator();
    rainCutoffLfo.type = 'sine';
    rainCutoffLfo.frequency.value = 0.041;
    const rainCutoffDepth = ctx.createGain();
    rainCutoffDepth.gain.value = 950;
    rainCutoffLfo.connect(rainCutoffDepth);
    rainCutoffDepth.connect(rainLowpass.frequency);
    const rainWanderDepth = ctx.createGain();
    rainWanderDepth.gain.value = 0.05;
    rainCutoffLfo.connect(rainWanderDepth);
    rainWanderDepth.connect(rainBedWander.gain);

    // Very slow gust (20-40 s): swell the rain, then let it fall back.
    rainGustPeriod = rand(RAIN_GUST_MIN, RAIN_GUST_MAX);
    const rainGustLfo = ctx.createOscillator();
    rainGustLfo.type = 'sine';
    rainGustLfo.frequency.value = 1 / rainGustPeriod;
    const rainGustDepth = ctx.createGain();
    rainGustDepth.gain.value = 0.3;
    rainGustLfo.connect(rainGustDepth);
    rainGustDepth.connect(rainBedWander.gain);

    rainSource.start(0, rand(0, 2.5));
    rainCutoffLfo.start();
    rainGustLfo.start();
    rainGustEpoch = ctx.currentTime;

    /* --- focus bed: heavily low-passed "room hush" --- */
    noiseLevel = ctx.createGain();
    noiseLevel.gain.value = 0;
    noiseLevel.connect(master);

    const hushSource = ctx.createBufferSource();
    hushSource.buffer = hushBuffer;
    hushSource.loop = true;

    const hushHigh = createFilter(ctx, 'highpass', 70, 0.5);
    hushLowpass = createFilter(ctx, 'lowpass', 620, 0.45);
    hushBody = ctx.createGain();
    hushBody.gain.value = NOISE_BED_GAIN;

    hushSource.connect(hushHigh);
    hushHigh.connect(hushLowpass);
    hushLowpass.connect(hushBody);
    hushBody.connect(noiseLevel);

    // One shared LFO: a tiny cutoff drift plus a whisper of level movement.
    const hushLfo = ctx.createOscillator();
    hushLfo.type = 'sine';
    hushLfo.frequency.value = 0.033;
    const hushCutoffDepth = ctx.createGain();
    hushCutoffDepth.gain.value = 140;
    hushLfo.connect(hushCutoffDepth);
    hushCutoffDepth.connect(hushLowpass.frequency);
    const hushWanderDepth = ctx.createGain();
    hushWanderDepth.gain.value = 0.0016;
    hushLfo.connect(hushWanderDepth);
    hushWanderDepth.connect(hushBody.gain);

    hushSource.start(0, rand(0, 3));
    hushLfo.start();
  }

  function teardownContext() {
    try {
      if (ctx && typeof ctx.close === 'function') {
        const closing = ctx.close();
        if (closing && typeof closing.catch === 'function') closing.catch(() => {});
      }
    } catch {
      /* ignore */
    }
    ctx = null;
    graphReady = false;
    master = null;
    limiter = null;
    ambienceBus = null;
    padBus = null;
    fireBus = null;
    rainLevel = null;
    rainPan = null;
    rainBedWander = null;
    rainLowpass = null;
    noiseLevel = null;
    hushBody = null;
    hushLowpass = null;
    roomBuffer = null;
    whiteBuffer = null;
    rainBuffer = null;
    hushBuffer = null;
  }

  function ensureContext() {
    if (ctx) return graphReady;
    if (!AudioCtor) return false;

    try {
      ctx = new AudioCtor();
    } catch {
      ctx = null;
      return false;
    }

    try {
      roomBuffer = buildWarmNoiseBuffer(ctx);
      whiteBuffer = buildWhiteNoiseBuffer(ctx);
      rainBuffer = buildRainBuffer(ctx);
      hushBuffer = buildHushBuffer(ctx);
      buildGraph();
      graphReady = true;
      return true;
    } catch {
      teardownContext();
      return false;
    }
  }

  /* ---------------- gain envelopes / volume ---------------- */

  function fadeGain(param, target, seconds) {
    if (!ctx || !param) return;
    const now = ctx.currentTime;
    const duration = Math.max(0.01, seconds);

    let from = param.value;
    const previous = paramFades.get(param);
    if (previous) {
      const progress = clamp01((now - previous.start) / previous.duration);
      from = previous.from + (previous.to - previous.from) * progress;
    }

    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(from, now);
      param.linearRampToValueAtTime(target, now + duration);
      paramFades.set(param, {
        start: now,
        from,
        to: target,
        duration,
      });
    } catch {
      try {
        param.value = target;
      } catch {
        /* ignore */
      }
    }
  }

  /** Write {volume, rain, noise} once per actual change; failures stay silent. */
  function persistSettings() {
    const payload = { volume, rain: rainOn, noise: noiseOn };
    const serialized = JSON.stringify(payload);
    if (serialized === persistedSnapshot) return;
    persistedSnapshot = serialized;
    writeStoredSettings(payload);
  }

  /** Set master volume (0..1) with a short ramp; persisted for next visit. */
  function setVolume(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) volume = clamp01(numeric);

    if (enabled && graphReady && master) fadeGain(master.gain, volume, 0.18);
    persistSettings();
    return volume;
  }

  /** Current master volume, 0..1. */
  function getVolume() {
    return volume;
  }

  /* ---------------- rain / hush layer gains ---------------- */

  function rainTargetGain() {
    return rainOn ? rainAmount : 0;
  }

  function noiseTargetGain() {
    return noiseOn ? noiseAmount : 0;
  }

  function applyRainGain(seconds) {
    if (!graphReady || !rainLevel) return;
    fadeGain(rainLevel.gain, rainTargetGain(), seconds);
  }

  function applyNoiseGain(seconds) {
    if (!graphReady || !noiseLevel) return;
    fadeGain(noiseLevel.gain, noiseTargetGain(), seconds);
  }

  /* ---------------- rain droplet scheduler ---------------- */

  /**
   * Estimate the current gust position from the LFO's own phase, so droplet
   * density follows the swell without any per-frame JS or extra oscillator.
   */
  function currentGust() {
    if (!ctx || rainGustPeriod <= 0) return 1;
    const elapsed = Math.max(0, ctx.currentTime - rainGustEpoch);
    const phase = (elapsed % rainGustPeriod) / rainGustPeriod;
    return 0.55 + 0.9 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
  }

  function clearRainTimer() {
    if (rainTimer) {
      clearTimeout(rainTimer);
      rainTimer = 0;
    }
  }

  function startRainScheduler() {
    if (rainTimer || !enabled || !rainOn || !graphReady) return;
    if (rainAmount <= 0.0005) return;
    rainTimer = setTimeout(rainTick, 260);
  }

  function rainTick() {
    rainTimer = 0;
    if (!enabled || !rainOn || !graphReady || !ctx) return;

    try {
      if (ctx.state === 'running' && volume > 0.0005 && rainAmount > 0.0005) {
        // 2-10 drops per second, swelled by the gust; quieter when hidden.
        const gust = currentGust();
        const perSecond = clamp(rand(2.6, 4.4) * gust, 2, 10) / (pageHidden ? 2.8 : 1);
        const spread = 1 / perSecond;
        const when = ctx.currentTime + 0.01;
        const drops = Math.random() < 0.25 ? 2 : 1;

        for (let i = 0; i < drops; i++) {
          const at = when + (i === 0 ? 0 : spread * rand(0.15, 0.6));
          const pan = clamp(RAIN_PAN + rand(-0.55, 0.55), -0.95, 0.95);
          if (Math.random() < 0.07) {
            // Now and then a wetter "plink" instead of a tick.
            playRainPlink(at, pan, rand(0.8, 1.1));
          } else {
            playRainDrop(at, pan, rand(0.6, 1.15));
          }
        }

        const gap = clamp(spread * rand(0.7, 1.35) * 1000, 90, 1600);
        rainTimer = setTimeout(rainTick, gap);
      } else {
        // Suspended or muted: idle cheaply instead of scheduling blindly.
        rainTimer = setTimeout(rainTick, 700);
      }
    } catch {
      rainTimer = setTimeout(rainTick, 900);
    }
  }

  /* ---------------- rain / hush public helpers ---------------- */

  /** Enable the window-rain layer; lazily starts the engine if it was idle. */
  async function enableRain() {
    rainOn = true;
    persistSettings();

    if (!enabled) {
      const started = await enable();
      if (!started) {
        rainOn = false;
        persistSettings();
        return false;
      }
    }

    applyRainGain(LAYER_FADE);
    if (rainOn) startRainScheduler();
    return rainOn;
  }

  /** Fade the window-rain layer out and stop its droplet scheduler. */
  function disableRain() {
    rainOn = false;
    persistSettings();
    clearRainTimer();
    applyRainGain(LAYER_FADE);
    stopWhenSilent();
    return false;
  }

  /** Toggle only the rain layer; resolves to the new rain state. */
  async function toggleRain() {
    if (rainOn) return disableRain();
    return enableRain();
  }

  /** True when the rain layer is switched on. */
  function isRainEnabled() {
    return rainOn;
  }

  /** Set the rain layer level (0..1) without touching the fireplace bed. */
  function setRainLevel(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) rainAmount = clamp01(numeric);

    applyRainGain(0.25);
    if (rainAmount <= 0.0005) clearRainTimer();
    else if (enabled && rainOn) startRainScheduler();
    return rainAmount;
  }

  /** Toggle only the white-noise layer, starting audio if this is the first layer. */
  async function toggleNoise() {
    noiseOn = !noiseOn;
    if (noiseOn && !await enable()) noiseOn = false;
    persistSettings();
    applyNoiseGain(LAYER_FADE);
    stopWhenSilent();
    return noiseOn;
  }

  /** True when the white-noise focus bed is switched on. */
  function isNoiseEnabled() {
    return noiseOn;
  }

  /** Set the white-noise focus bed level (0..1), independent of rain/fire. */
  function setNoiseLevel(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) noiseAmount = clamp01(numeric);

    applyNoiseGain(0.25);
    return noiseAmount;
  }

  /* ---------------- fireplace scheduler ---------------- */

  function clearFireTimer() {
    if (fireTimer) {
      clearTimeout(fireTimer);
      fireTimer = 0;
    }
  }

  function nextFireDelay() {
    let delay = rand(FIRE_GAP_MIN, FIRE_GAP_MAX);
    // A hidden page should sound like the room is settling down, not stop.
    if (pageHidden) delay *= rand(2.6, 3.4);
    return delay;
  }

  function queueFireplace(delay) {
    if (!enabled || !fireOn) return;
    clearFireTimer();
    fireTimer = setTimeout(fireTick, delay);
  }

  function fireTick() {
    fireTimer = 0;
    if (!enabled || !fireOn) return;
    if (ctx && ctx.state === 'running' && volume > 0.0005) {
      playCrackle(rand(0.45, 1));
    }
    queueFireplace(nextFireDelay());
  }

  function onVisibilityChange() {
    const hidden =
      typeof document !== 'undefined' &&
      (document.visibilityState === 'hidden' || document.hidden === true);
    if (hidden === pageHidden) return;
    pageHidden = hidden;
    if (enabled) {
      // Re-phase the sparse crackles when tab visibility changes.
      queueFireplace(pageHidden ? rand(1800, 3400) : rand(450, 900));
    }
    if (enabled && rainOn) {
      // Droplets thin out (or thicken) immediately; the bed keeps playing.
      clearRainTimer();
      startRainScheduler();
    }
  }

  function bindVisibility() {
    if (visibilityBound) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return;
    }
    visibilityBound = true;
    pageHidden =
      document.visibilityState === 'hidden' || document.hidden === true;
    document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
  }

  /* ---------------- one-shot foley ---------------- */

  function canPlay() {
    return (
      enabled &&
      graphReady &&
      !!ctx &&
      ctx.state === 'running' &&
      volume > 0.0005
    );
  }

  /** Short paper noise through a downward band-pass sweep. */
  function playPaperRustle(when, pan, peak, duration, brightness) {
    const source = ctx.createBufferSource();
    source.buffer = whiteBuffer;
    source.playbackRate.value = rand(0.88, 1.12);

    const high = createFilter(ctx, 'highpass', rand(420, 620), 0.6);
    const band = createFilter(ctx, 'bandpass', brightness, 0.7);
    band.frequency.setValueAtTime(brightness, when);
    band.frequency.exponentialRampToValueAtTime(rand(600, 900), when + duration);

    const envelope = createDecayEnvelope(ctx, when, peak, 0.016, duration);
    const panner = createPanner(ctx, pan);

    source.connect(high);
    high.connect(band);
    band.connect(envelope);
    envelope.connect(panner);
    panner.connect(master);

    source.start(when, rand(0, 0.9));
    source.stop(when + duration + 0.03);
    releaseAfter(source, [high, band, envelope, panner]);
  }

  /** Low wooden-body thump for opening and closing the volume. */
  function playBookThump(when, isOpen, strength) {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(isOpen ? rand(98, 116) : rand(82, 100), when);
    oscillator.frequency.exponentialRampToValueAtTime(
      isOpen ? rand(46, 56) : rand(38, 48),
      when + (isOpen ? 0.22 : 0.18)
    );

    const low = createFilter(ctx, 'lowpass', isOpen ? 260 : 220, 0.7);
    const envelope = createDecayEnvelope(
      ctx,
      when,
      (isOpen ? 0.13 : 0.11) * strength,
      0.012,
      isOpen ? 0.34 : 0.28
    );
    const panner = createPanner(ctx, rand(-0.1, 0.1));

    oscillator.connect(low);
    low.connect(envelope);
    envelope.connect(panner);
    panner.connect(master);

    oscillator.start(when);
    oscillator.stop(when + (isOpen ? 0.38 : 0.32));
    releaseAfter(oscillator, [low, envelope, panner]);
  }

  /**
   * Tiny pre-flip "paper lift": a dry, very short high tick that makes the
   * page feel like it is being pinched before the whoosh starts.
   */
  function playPaperLift(when, pan, strength) {
    const source = ctx.createBufferSource();
    source.buffer = whiteBuffer;
    source.playbackRate.value = rand(0.95, 1.4);

    const band = createFilter(ctx, 'bandpass', rand(3200, 5400), 1.15);
    const envelope = createDecayEnvelope(
      ctx,
      when,
      rand(0.012, 0.026) * strength,
      0.002,
      rand(0.018, 0.036)
    );
    const panner = createPanner(ctx, clamp(pan + rand(-0.05, 0.05), -1, 1));

    source.connect(band);
    band.connect(envelope);
    envelope.connect(panner);
    panner.connect(master);

    source.start(when, rand(0, 1.5));
    source.stop(when + 0.05);
    releaseAfter(source, [band, envelope, panner]);
  }

  function playPageFlip(direction) {
    if (!canPlay()) return;
    try {
      const dir = direction === -1 ? -1 : 1;
      // Per-turn variation: no two flips share the same pitch, level or pan.
      const liftAt = ctx.currentTime + 0.004;
      const when = liftAt + rand(0.014, 0.03);
      const duration = rand(0.1, 0.155);
      const peak = rand(0.07, 0.145);
      const pan = clamp(dir * rand(0.1, 0.22) + rand(-0.08, 0.08), -0.6, 0.6);

      // 1) the paper being pinched and lifted
      playPaperLift(liftAt, pan, rand(0.75, 1.2));

      // 2) the whoosh of the sheet travelling over
      const source = ctx.createBufferSource();
      source.buffer = whiteBuffer;
      source.playbackRate.value =
        rand(0.76, 1.18) * (dir > 0 ? 1 : 0.95);

      const high = createFilter(ctx, 'highpass', rand(480, 800), 0.6);
      const band = createFilter(
        ctx,
        'bandpass',
        dir > 0 ? rand(2350, 3350) : rand(1400, 2150),
        rand(0.7, 1.0)
      );
      band.frequency.setValueAtTime(band.frequency.value, when);
      band.frequency.exponentialRampToValueAtTime(
        dir > 0 ? rand(600, 900) : rand(460, 720),
        when + duration
      );

      const envelope = createDecayEnvelope(ctx, when, peak, 0.006, duration);
      const panner = createPanner(ctx, pan);

      source.connect(high);
      high.connect(band);
      band.connect(envelope);
      envelope.connect(panner);
      panner.connect(master);

      source.start(when, rand(0, 0.9));
      source.stop(when + duration + 0.035);
      releaseAfter(source, [high, band, envelope, panner]);

      // 3) sometimes the sheet settles with a quiet second flutter
      if (Math.random() < 0.3) {
        playPaperRustle(
          when + duration * rand(0.7, 1.1),
          pan - dir * 0.08,
          peak * rand(0.16, 0.3),
          rand(0.05, 0.09),
          rand(1600, 2600)
        );
      }
    } catch {
      /* Audio is decorative; never let a node error break the scene. */
    }
  }

  function playOpen() {
    if (!canPlay()) return;
    try {
      const when = ctx.currentTime + 0.004;
      playBookThump(when, true, 1);
      playPaperRustle(when + 0.012, rand(-0.14, 0.14), 0.05, 0.22, rand(1500, 2000));
      playPaperRustle(when + 0.105, rand(-0.18, 0.18), 0.028, 0.17, rand(1200, 1700));
    } catch {
      /* ignore */
    }
  }

  function playClose() {
    if (!canPlay()) return;
    try {
      const when = ctx.currentTime + 0.004;
      playBookThump(when, false, 1);
      playPaperRustle(when + 0.008, rand(-0.12, 0.12), 0.04, 0.14, rand(1000, 1450));
      playBookThump(when + 0.06, false, 0.34);
      playPaperRustle(when + 0.075, rand(-0.1, 0.1), 0.018, 0.09, rand(900, 1300));
    } catch {
      /* ignore */
    }
  }

  /** One tiny dry pop from the fire. */
  function playFirePop(when, strength) {
    const source = ctx.createBufferSource();
    source.buffer = whiteBuffer;
    source.playbackRate.value = rand(0.8, 1.25);

    const high = createFilter(ctx, 'highpass', rand(850, 1400), 0.6);
    const low = createFilter(ctx, 'lowpass', rand(4800, 7200), 0.4);
    const decay = rand(0.035, 0.085);
    const envelope = createDecayEnvelope(
      ctx,
      when,
      rand(0.025, 0.067) * strength,
      0.002,
      decay
    );
    const panner = createPanner(ctx, rand(-0.75, 0.75));

    source.connect(high);
    high.connect(low);
    low.connect(envelope);
    envelope.connect(panner);
    panner.connect(fireBus);

    source.start(when, rand(0, 0.8));
    source.stop(when + decay + 0.03);
    releaseAfter(source, [high, low, envelope, panner]);
  }

  /** Occasional soft low knock under a crackle. */
  function playEmberThump(when, strength) {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(rand(72, 108), when);
    oscillator.frequency.exponentialRampToValueAtTime(rand(40, 52), when + 0.2);

    const low = createFilter(ctx, 'lowpass', 160, 0.6);
    const envelope = createDecayEnvelope(
      ctx,
      when,
      rand(0.018, 0.034) * strength,
      0.008,
      0.22
    );
    const panner = createPanner(ctx, rand(-0.4, 0.4));

    oscillator.connect(low);
    low.connect(envelope);
    envelope.connect(panner);
    panner.connect(fireBus);

    oscillator.start(when);
    oscillator.stop(when + 0.26);
    releaseAfter(oscillator, [low, envelope, panner]);
  }

  /** One rain droplet: a very short band-passed noise tick (2-6 kHz). */
  function playRainDrop(when, pan, strength) {
    const decay = rand(0.012, 0.045);
    const source = ctx.createBufferSource();
    source.buffer = whiteBuffer;
    source.playbackRate.value = rand(0.9, 1.35);

    const band = createFilter(ctx, 'bandpass', rand(2000, 6000), rand(1.3, 3.2));
    const envelope = createDecayEnvelope(
      ctx,
      when,
      rand(0.02, 0.06) * strength,
      0.0018,
      decay
    );
    const panner = createPanner(ctx, clamp(pan, -1, 1));

    source.connect(band);
    band.connect(envelope);
    envelope.connect(panner);
    panner.connect(rainLevel);

    source.start(when, rand(0, 1.4));
    source.stop(when + decay + 0.03);
    releaseAfter(source, [band, envelope, panner]);
  }

  /** A wetter "plink": sine blip with a fast downward pitch drop. */
  function playRainPlink(when, pan, strength) {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    const top = rand(1500, 2600);
    oscillator.frequency.setValueAtTime(top, when);
    oscillator.frequency.exponentialRampToValueAtTime(
      top * rand(0.45, 0.62),
      when + rand(0.07, 0.14)
    );

    const low = createFilter(ctx, 'lowpass', rand(4200, 6200), 0.5);
    const envelope = createDecayEnvelope(
      ctx,
      when,
      rand(0.016, 0.032) * strength,
      0.003,
      rand(0.09, 0.16)
    );
    const panner = createPanner(ctx, clamp(pan, -1, 1));

    oscillator.connect(low);
    low.connect(envelope);
    envelope.connect(panner);
    panner.connect(rainLevel);

    oscillator.start(when);
    oscillator.stop(when + 0.2);
    releaseAfter(oscillator, [low, envelope, panner]);
  }

  function playCrackle(strength) {
    if (!canPlay()) return;
    try {
      const when = ctx.currentTime + 0.004;
      // Mostly a single tick; now and then a natural two-pop cluster.
      const pops = Math.random() < 0.24 ? 2 : 1;
      for (let i = 0; i < pops; i++) {
        playFirePop(
          when + i * rand(0.05, 0.12),
          strength * (i === 0 ? 1 : 0.65)
        );
      }
      if (Math.random() < 0.3) playEmberThump(when + rand(0, 0.08), strength);
    } catch {
      /* ignore */
    }
  }

  /* ---------------- lifecycle ---------------- */

  function cancelSuspendedTimer() {
    if (suspendTimer) {
      clearTimeout(suspendTimer);
      suspendTimer = 0;
    }
  }

  async function runEnable(epoch) {
    if (!ensureContext()) return false;
    cancelSuspendedTimer();

    try {
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        await ctx.resume();
      }
    } catch {
      return false;
    }

    // A disable() may have raced the resume; honour the latest request.
    if (epoch !== controlEpoch) return false;
    if (ctx.state !== 'running') return false;

    enabled = true;
    fadeGain(master.gain, volume, MASTER_FADE_IN);
    fadeGain(padBus.gain, fireOn ? 1 : 0, PAD_FADE_IN);
    fadeGain(fireBus.gain, fireOn ? 1 : 0, LAYER_FADE);
    // Restored rain / hush preferences start here - never before a gesture.
    applyRainGain(LAYER_FADE);
    applyNoiseGain(LAYER_FADE);
    if (rainOn) startRainScheduler();
    bindVisibility();
    queueFireplace(pageHidden ? rand(1800, 3400) : rand(450, 900));

    if (!announced) {
      announced = true;
      try {
        console.info('[cozy-bookstore] ambient audio enabled');
      } catch {
        /* console can be unavailable in exotic environments */
      }
    }
    return true;
  }

  async function enable() {
    if (!AudioCtor) return false;

    if (enabled) {
      try {
        if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted')) {
          await ctx.resume();
        }
      } catch {
        return false;
      }
      return enabled;
    }

    if (enablePromise) return enablePromise;

    const epoch = ++controlEpoch;
    const pending = runEnable(epoch)
      .catch(() => false)
      .finally(() => {
        if (enablePromise === pending) enablePromise = null;
      });
    enablePromise = pending;
    return pending;
  }

  function disable() {
    controlEpoch++;
    // A pending enable() must not be reused after this request: it will see
    // the stale epoch and bail out, so a fresh enable() can start cleanly.
    enablePromise = null;
    enabled = false;
    fireOn = false;
    clearFireTimer();
    clearRainTimer();

    if (!ctx || !graphReady || !master) return;

    if (ctx.state === 'running') {
      fadeGain(master.gain, 0, MASTER_FADE_OUT);
      if (padBus) fadeGain(padBus.gain, 0, PAD_FADE_OUT);
      if (fireBus) fadeGain(fireBus.gain, 0, LAYER_FADE);
      // Layers ride the master fade but are parked at zero so a re-enable
      // always ramps them back up from silence instead of popping in.
      if (rainLevel) fadeGain(rainLevel.gain, 0, LAYER_FADE);
      if (noiseLevel) fadeGain(noiseLevel.gain, 0, LAYER_FADE);
    } else {
      try {
        master.gain.value = 0;
        if (padBus) padBus.gain.value = 0;
        if (fireBus) fireBus.gain.value = 0;
        if (rainLevel) rainLevel.gain.value = 0;
        if (noiseLevel) noiseLevel.gain.value = 0;
      } catch {
        /* ignore */
      }
    }

    cancelSuspendedTimer();
    const epoch = controlEpoch;
    suspendTimer = setTimeout(() => {
      suspendTimer = 0;
      if (enabled || epoch !== controlEpoch || !ctx) return;
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(0, ctx.currentTime);
        if (padBus) {
          padBus.gain.cancelScheduledValues(ctx.currentTime);
          padBus.gain.setValueAtTime(0, ctx.currentTime);
        }
        for (const layer of [rainLevel, noiseLevel]) {
          if (!layer) continue;
          layer.gain.cancelScheduledValues(ctx.currentTime);
          layer.gain.setValueAtTime(0, ctx.currentTime);
        }
      } catch {
        /* ignore */
      }
      if (ctx.state === 'running') {
        try {
          const suspended = ctx.suspend();
          if (suspended && typeof suspended.catch === 'function') suspended.catch(() => {});
        } catch {
          /* ignore */
        }
      }
    }, MASTER_FADE_OUT * 1000 + 90);
  }

  function stopWhenSilent() {
    if (!fireOn && !rainOn && !noiseOn) disable();
  }

  async function toggle() {
    fireOn = !fireOn;
    if (fireOn && !await enable()) fireOn = false;
    if (enabled) {
      fadeGain(fireBus.gain, fireOn ? 1 : 0, LAYER_FADE);
      fadeGain(padBus.gain, fireOn ? 1 : 0, fireOn ? PAD_FADE_IN : PAD_FADE_OUT);
    }
    if (fireOn) queueFireplace(rand(450, 900));
    else clearFireTimer();
    stopWhenSilent();
    return fireOn;
  }

  function isEnabled() {
    return enabled;
  }

  /* ---------------- public API ---------------- */

  return {
    enable,
    disable,
    toggle,
    isEnabled,
    playPageFlip,
    playOpen,
    playClose,
    setVolume,
    getVolume,
    toggleRain,
    enableRain,
    disableRain,
    isRainEnabled,
    setRainLevel,
    toggleNoise,
    isNoiseEnabled,
    setNoiseLevel,
  };
}
