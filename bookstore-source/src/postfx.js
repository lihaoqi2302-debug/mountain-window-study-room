/**
 * Cozy Bookstore post-processing pipeline.
 *
 * The main app owns the renderer settings:
 *   renderer.toneMapping = THREE.ACESFilmicToneMapping;
 *   renderer.outputColorSpace = THREE.SRGBColorSpace;
 *
 * Every pass before OutputPass works on linear HDR colour inside the
 * EffectComposer's half-float targets. OutputPass is deliberately the last
 * *colour* pass so ACES tone mapping + the sRGB transfer happen exactly once.
 *
 * Pass order (all optional passes degrade silently to a simpler chain):
 *   1. RenderPass      - scene -> linear HDR buffer
 *   3. UnrealBloomPass - bloom for the lamp shade and the hottest highlights only
 *   4. BokehPass       - depth of field, brief book-focused camera moves on high
 *   5. Grade pass      - warm grade + soft S-curve + vignette + grain + edge CA
 *   6. OutputPass      - ACES tone mapping + sRGB conversion -> screen
 *   7. FXAAPass        - screen-space antialiasing when MSAA is off
 *
 * Usage:
 *   import { createPostFX } from './postfx.js';
 *   const fx = createPostFX(renderer, scene, camera);
 *   fx.render(dt);                 // every frame, instead of renderer.render()
 *   fx.setSize(width, height);     // on resize
 *   fx.setReadingMode(true/false); // optional reading-mode tuning
 *   fx.setFocus?.(1.05, 0.0016);   // reading-mode focus (metres) + aperture
 *   fx.setQuality?.('high');       // 'high' | 'medium' | 'low'
 */

import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { opaqueAmbientRender } from './ambient-visibility.js';

/* ------------------------------------------------------------------ */
/*  Tuning presets                                                     */
/* ------------------------------------------------------------------ */

/**
 * Explore mode. Bloom is thresholded in linear HDR so only the
 * lamp shade, the string-light bulbs and specular fireflies cross it -- matte
 * white paper sits well below 1.0 and therefore never blooms.
 */
const NORMAL = Object.freeze({
  bloomStrength: 0.15,
  bloomRadius: 0.24,
  bloomThreshold: 1.27,
  vignette: 0.135,
  grain: 0.027,    // screen-fixed fine grain
  warmth: 1.0,
  brightness: 1.0,
  contrast: 0.095,     // gentle filmic S-curve (0 = identity)
  chromatic: 0.0,    // ~0.5 device pixel of CA at the frame border (0 = off)
});

/**
 * Reading mode. Near-zero grain, no chromatic aberration, no vignette over the
 * page, and bloom reduced to a whisper so the text stays crisp.
 */
const READING = Object.freeze({
  bloomStrength: 0.08,
  bloomRadius: 0.42,
  bloomThreshold: 1.15,
  vignette: 0.022,
  grain: 0.0,
  warmth: 0.4,
  brightness: 1.045,
  contrast: 0.028,
  chromatic: 0.0,
});

/** Focus smoothing during the two camera moves. */
const DOF = Object.freeze({
  defaultFocus: 1.05,   // metres -> the open book
  aperture: 0.0016,
  maxBlur: 0.006,
  focusSmoothing: 0.12, // seconds, exponential smoothing time constant
});

/** MSAA sample counts per quality level. */
const MSAA = Object.freeze({
  high: 4,
  medium: 2,
  low: 0,
});

/* ------------------------------------------------------------------ */
/*  Combined colour-grade pass                                         */
/*  warm grade + soft S-curve + vignette + grain + edge CA              */
/* ------------------------------------------------------------------ */

const GradeShader = {
  name: 'CozyBookstoreGradeShader',

  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: NORMAL.vignette },
    uGrain: { value: NORMAL.grain },
    uWarmth: { value: NORMAL.warmth },
    uBrightness: { value: NORMAL.brightness },
    uContrast: { value: NORMAL.contrast },
    uChromatic: { value: NORMAL.chromatic },
    uResolution: { value: new Vector2(1, 1) },
  },

  vertexShader: /* glsl */`
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uWarmth;
    uniform float uBrightness;
    uniform float uContrast;
    uniform float uChromatic;
    uniform vec2 uResolution;

    varying vec2 vUv;

    // Cheap, stable hash for the film grain.
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    bool validHdr(vec3 rgb) {
      return all(greaterThanEqual(rgb, vec3(0.0))) && all(lessThanEqual(rgb, vec3(65504.0)));
    }

    void main() {
      vec2 uv = vUv;
      vec4 texel = texture2D(tDiffuse, uv);
      vec3 color = texel.rgb;

      // Edge distances: 0 at the centre, 1 at the middle of each edge,
      // sqrt(2) in the corners.
      vec2 edgeUV = abs(uv - 0.5) * 2.0;
      float edgeDist = length(edgeUV);

      // Sub-pixel chromatic aberration, edge weighted and expressed in device
      // pixels (uChromatic is the border offset, ~1px). Green stays centred, so
      // the effect is invisible in the middle of the frame; uChromatic = 0
      // collapses both offsets to zero, which is what reading mode uses over
      // the page.
      vec2 caOffset =
        (uv - 0.5) * uChromatic * smoothstep(0.45, 1.05, edgeDist) / max(uResolution, vec2(1.0));
      if (uChromatic > 0.0) {
        color.r = texture2D(tDiffuse, uv + caOffset).r;
        color.b = texture2D(tDiffuse, uv - caOffset).b;
      }
      // Repair an isolated bad scene pixel before the grade and tone mapping.
      if (!validHdr(color)) {
        vec2 pixel = vec2(1.0, 0.0) / max(uResolution, vec2(1.0));
        vec3 adjacent = texture2D(tDiffuse, uv + pixel).rgb;
        if (!validHdr(adjacent)) adjacent = texture2D(tDiffuse, uv - pixel).rgb;
        color = validHdr(adjacent) ? adjacent : vec3(0.0);
      }

      // A barely-there exposure lift (reading mode) and warm film grade.
      // Both happen in linear HDR space, before OutputPass tone maps.
      color *= uBrightness;

      vec3 warmTint = mix(vec3(1.0), vec3(1.014, 1.002, 0.984), uWarmth);
      color *= warmTint;

      // Very gentle filmic S-curve. x = c / (1 + c) is a monotonic Reinhard
      // compression into [0,1); smoothstep() on it adds contrast around the
      // mid tones and the inverse maps back to linear HDR. uContrast = 0 is an
      // exact identity, so the curve is purely additive in look.
      vec3 x = color / (1.0 + color);
      x = mix(x, x * x * (3.0 - 2.0 * x), uContrast);
      color = min(x / max(vec3(1.0) - x, vec3(1e-4)), vec3(64.0));

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float shadowMask = 1.0 - smoothstep(0.0, 0.24, luma);
      color += vec3(0.0007, 0.0017, 0.0029) * shadowMask * uWarmth;

      // Soft vignette. With uVignette = 0.14 this gives roughly 9% darkening at
      // the edge midpoints and 14% in the corners.
      float vignetteMask = smoothstep(0.62, 1.3, edgeDist);
      color *= 1.0 - vignetteMask * uVignette;

      // Very light screen-fixed film grain. Multiplicative so true blacks stay
      // black and the amplitude is a percentage of the local colour.
      vec2 grainCell = floor(uv * uResolution);
      float n1 = hash12(grainCell);
      float n2 = hash12(grainCell.yx + vec2(53.0, 97.0));
      float grain = (n1 + n2 * 0.5) / 1.5 - 0.5;
      float grainLuma = mix(0.35, 1.0, smoothstep(0.02, 0.45, luma));
      color *= 1.0 + grain * uGrain * grainLuma;

      gl_FragColor = vec4(max(color, vec3(0.0)), texel.a);
    }
  `,
};

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the post-processing pipeline.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @returns {{
 *   composer: EffectComposer,
 *   render: (dt?: number) => boolean,
 *   setSize: (width: number, height: number) => boolean,
 *   setReadingMode: (reading: boolean) => void,
 *   setFocus: (distance: number, aperture?: number) => void,
 *   setQuality: (level: 'high'|'medium'|'low') => void,
 *   renderPass: RenderPass,
 *   bloomPass: UnrealBloomPass,
 *   gradePass: ShaderPass,
 *   outputPass: OutputPass,
 *   aoPass: null,
 *   dofPass: BokehPass|null,
 *   uniforms: Object,
 *   stats: Object,
 *   dispose: () => void,
 * }}
 */
export function createPostFX(renderer, scene, camera) {
  /* ---------------------------------------------------------------- */
  /*  Composer with multisampled (MSAA) render targets                 */
  /* ---------------------------------------------------------------- */

  // three r187 is WebGL2-only, but stay defensive: on a WebGL1 context float
  // render targets cannot be multisampled, so fall back to FXAA instead.
  const msaaAvailable = !(renderer.capabilities && renderer.capabilities.isWebGL2 === false);

  const state = {
    reading: false,
    shotStrength: 0,
    quality: 'high',
    width: 0,
    height: 0,
    focusTarget: DOF.defaultFocus,
    focusCurrent: DOF.defaultFocus,
    aperture: DOF.aperture,
  };

  let samples = msaaAvailable ? MSAA.high : 0;
  let composer;

  try {
    const logical = renderer.getSize(new Vector2());
    const ratio = readPixelRatio();
    const target = new WebGLRenderTarget(
      Math.max(1, Math.floor((logical.x || 1) * ratio)),
      Math.max(1, Math.floor((logical.y || 1) * ratio)),
      {
        type: HalfFloatType,
        depthBuffer: true,
        stencilBuffer: false,
        samples,
      }
    );
    target.texture.name = 'CozyBookstore.rt1';
    // Passing our own target also makes EffectComposer clone it for rt2,
    // which inherits the same `samples` value.
    composer = new EffectComposer(renderer, target);
  } catch (err) {
    // No multisampled half-float target support -> plain composer + FXAA.
    samples = 0;
    composer = new EffectComposer(renderer);
  }

  composer.renderToScreen = true;

  /* ---------------------------------------------------------------- */
  /*  Passes                                                           */
  /* ---------------------------------------------------------------- */

  const renderPass = new RenderPass(scene, camera);

  const bloomPass = new UnrealBloomPass(
    new Vector2(1, 1),
    NORMAL.bloomStrength,
    NORMAL.bloomRadius,
    NORMAL.bloomThreshold
  );
  // A gradual bright-pass knee keeps a highlight from popping in or out
  // when a moving bulb or reflection crosses the extraction threshold.
  bloomPass.highPassUniforms.smoothWidth.value = 0.24;
  // A single non-finite HDR sample can spread across the frame through
  // the blur mip chain. Discard it before luminance and blur, keeping
  // finite highlights and the normal exposure curve intact.
  const brightFilter = bloomPass.materialHighPassFilter;
  brightFilter.fragmentShader = brightFilter.fragmentShader.replace(
    'float v = luminance( texel.xyz );',
    `if ( !all( greaterThanEqual( texel.rgb, vec3( 0.0 ) ) )
          || !all( lessThanEqual( texel.rgb, vec3( 65504.0 ) ) ) ) {
        gl_FragColor = vec4( 0.0 );
        return;
      }
      float v = luminance( texel.xyz );`,
  );

  const gradePass = new ShaderPass(GradeShader);
  const outputPass = new OutputPass();

  // Contacts are baked into object-space shading and the floor decals.
  // Depth of field. Built once, then toggled with `enabled`; a disabled pass
  // costs nothing because EffectComposer skips it entirely.
  let dofPass = null;
  try {
    dofPass = new BokehPass(scene, camera, {
      focus: state.focusCurrent,
      aperture: state.aperture,
      maxblur: DOF.maxBlur,
    });
    dofPass.render = opaqueAmbientRender(scene, dofPass.render.bind(dofPass));
    dofPass.enabled = false;
  } catch (err) {
    dofPass = null;
  }

  // Edge antialiasing only when multisampling is unavailable. It runs *after*
  // OutputPass, i.e. on the tone-mapped sRGB image, which is where FXAA works.
  const fxaaPass = new FXAAPass();
  fxaaPass.enabled = samples === 0;

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  if (dofPass) composer.addPass(dofPass); // after bloom, before the grade
  composer.addPass(gradePass);
  composer.addPass(outputPass);
  composer.addPass(fxaaPass);

  const uniforms = gradePass.uniforms;

  /** Live, read-only-ish diagnostics for the app / devtools. */
  const stats = {
    quality: state.quality,
    samples,
    msaa: msaaAvailable,
    ao: false,
    aoScale: 0,
    aoSamples: 0,
    dof: false,
    focus: state.focusTarget,
    aperture: state.aperture,
    width: 0,
    height: 0,
    pixelRatio: readPixelRatio(),
  };

  let lastPixelRatio = readPixelRatio();
  let validSize = false;
  let disposed = false;

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                          */
  /* ---------------------------------------------------------------- */

  function readPixelRatio() {
    const ratio = Number(renderer.getPixelRatio());
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  }

  /** Push the device-pixel resolution into the grade uniforms. */
  function syncResolution() {
    uniforms.uResolution.value.set(
      Math.max(1, composer.renderTarget1.width),
      Math.max(1, composer.renderTarget1.height)
    );
  }

  /** Apply an MSAA sample count to both composer targets (0 = off). */
  function applySamples(next) {
    const count = Math.max(0, Math.min(8, Math.floor(Number(next) || 0)));
    samples = count;
    stats.samples = count;
    fxaaPass.enabled = count === 0;

    const t1 = composer.renderTarget1;
    const t2 = composer.renderTarget2;
    if (!t1 || !t2) return;
    if (t1.samples === count && t2.samples === count) return;

    t1.samples = count;
    t2.samples = count;
    // Changing `samples` requires a fresh multisampled framebuffer allocation.
    t1.dispose();
    t2.dispose();
  }

  /** The page stays crisp once the camera comes to rest. */
  function updateDofState() {
    const want = Boolean(dofPass) && state.shotStrength > 0 && state.quality === 'high' && validSize;
    if (dofPass) {
      dofPass.enabled = want;
      // BokehShader scales offsets by 0.4 UV. Cap the radius in device pixels.
      dofPass.uniforms.maxblur.value = 4.0 * state.shotStrength / Math.max(1, composer.renderTarget1.width);
      dofPass.uniforms.aperture.value = state.aperture;
      if (want) {
        dofPass.uniforms.focus.value = state.focusCurrent;
      } else {
        // Snap while bypassed so re-entering reading mode never pops.
        state.focusCurrent = state.focusTarget;
      }
    }
    stats.dof = want;
  }

  function setShotFocus(distance, strength) {
    state.shotStrength = strength;
    if (strength > 0) setFocus(distance, .0018 * strength);
    updateDofState();
  }

  function updateStats() {
    stats.quality = state.quality;
    stats.focus = state.focusTarget;
    stats.aperture = state.aperture;
    stats.width = state.width;
    stats.height = state.height;
    stats.pixelRatio = lastPixelRatio;
  }

  /* ---------------------------------------------------------------- */
  /*  Public API                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Resize the composer, every pass, and the grade uniforms.
   * Invalid/zero sizes are ignored; render() also refuses to draw until a
   * positive size has been supplied.
   */
  function setSize(nextWidth, nextHeight) {
    if (disposed) return false;

    const w = Math.floor(Number(nextWidth));
    const h = Math.floor(Number(nextHeight));

    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
      state.width = 0;
      state.height = 0;
      validSize = false;
      updateDofState();
      updateStats();
      return false;
    }

    state.width = w;
    state.height = h;

    const pixelRatio = readPixelRatio();
    if (pixelRatio !== lastPixelRatio) {
      lastPixelRatio = pixelRatio;
      // EffectComposer.setPixelRatio() honours its current logical size.
      composer.setPixelRatio(pixelRatio);
    }

    // Composer applies the current pixel ratio to its targets and all passes
    // (including the bloom mip chain and the OutputPass).
    composer.setSize(state.width, state.height);

    syncResolution();

    validSize = true;
    updateDofState();
    updateStats();
    return true;
  }

  /** Switch the subtle normal-grade settings for legible reading mode. */
  function setReadingMode(nextReading) {
    state.reading = Boolean(nextReading);
    if (disposed) return;

    const preset = state.reading ? READING : NORMAL;

    bloomPass.strength = preset.bloomStrength;
    bloomPass.radius = preset.bloomRadius;
    bloomPass.threshold = preset.bloomThreshold;

    uniforms.uVignette.value = preset.vignette;
    uniforms.uGrain.value = preset.grain;
    uniforms.uWarmth.value = preset.warmth;
    uniforms.uBrightness.value = preset.brightness;
    uniforms.uContrast.value = preset.contrast;
    uniforms.uChromatic.value = preset.chromatic;


    updateDofState();
    updateStats();
  }

  /**
   * Set the depth-of-field focus (metres along the view direction) and,
   * optionally, the aperture. Values are smoothed over ~120 ms in render().
   */
  function setFocus(distance, aperture) {
    const d = Number(distance);
    if (Number.isFinite(d) && d > 0) {
      const near = Number.isFinite(camera.near) ? Math.max(0.01, camera.near) : 0.01;
      const far = Number.isFinite(camera.far) ? Math.max(near + 0.01, camera.far) : 1000;
      state.focusTarget = Math.min(far, Math.max(near, d));
    }

    const a = Number(aperture);
    if (Number.isFinite(a) && a > 0) {
      state.aperture = Math.min(1, Math.max(1e-6, a));
    }

    if (dofPass) {
      dofPass.uniforms.aperture.value = state.aperture;
      if (!dofPass.enabled) state.focusCurrent = state.focusTarget;
    }
    updateStats();
  }

  /**
   * 'high'   - MSAA x4, DOF during camera motion
   * 'medium' - MSAA x2
   * 'low'    - no AO, DOF, bloom or MSAA
   */
  function setQuality(level) {
    if (disposed) return;
    state.quality = level === 'low' ? 'low' : level === 'medium' ? 'medium' : 'high';
    // The unsampled low path can produce transparent frames in software renderers with bloom enabled.
    bloomPass.enabled = state.quality !== 'low';

    const desired = !msaaAvailable
      ? 0
      : state.quality === 'low'
        ? MSAA.low
        : state.quality === 'medium'
          ? MSAA.medium
          : MSAA.high;
    applySamples(desired);

    updateDofState();
    updateStats();
  }

  /**
   * Render one frame through the composer. This is the only render entry
   * point; do not also call renderer.render(...) for the same frame.
   */
  function render(dt = 0) {
    if (disposed) return false;

    // Guard against hidden/zero-sized windows and a zero-sized composer.
    if (
      !validSize ||
      composer.renderTarget1.width < 1 ||
      composer.renderTarget1.height < 1
    ) {
      return false;
    }

    // If the app changed renderer.setPixelRatio() outside setSize(), pick it
    // up here without rebuilding the pass chain.
    const pixelRatio = readPixelRatio();
    if (pixelRatio !== lastPixelRatio) {
      lastPixelRatio = pixelRatio;
      composer.setPixelRatio(pixelRatio);
        syncResolution();
    }

    const delta = Number.isFinite(dt) ? Math.max(0, dt) : 0;

    // Smoothed focus so racking to the page never pops.
    if (dofPass && dofPass.enabled) {
      const k = delta > 0 ? 1 - Math.exp(-delta / DOF.focusSmoothing) : 1;
      state.focusCurrent += (state.focusTarget - state.focusCurrent) * Math.min(1, k);
      if (Math.abs(state.focusTarget - state.focusCurrent) < 1e-4) {
        state.focusCurrent = state.focusTarget;
      }
      dofPass.uniforms.focus.value = state.focusCurrent;
      stats.focus = state.focusCurrent;
    }

    composer.render(delta);
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const pass of composer.passes) {
      if (typeof pass.dispose === 'function') pass.dispose();
    }
    composer.dispose();
  }

  // Match the current canvas immediately. If it is still 0x0, render() waits
  // for the first real setSize() call.
  const initialSize = renderer.getSize(new Vector2());
  setSize(initialSize.x, initialSize.y);
  updateStats();

  return {
    composer,
    render,
    setSize,
    setReadingMode,
    setFocus,
    setShotFocus,
    setQuality,
    renderPass,
    bloomPass,
    gradePass,
    outputPass,
    aoPass: null,
    dofPass,
    uniforms,
    stats,
    dispose,
    get readingMode() {
      return state.reading;
    },
    get quality() {
      return state.quality;
    },
  };
}
