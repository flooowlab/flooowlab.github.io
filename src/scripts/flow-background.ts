import {
  CanvasTexture,
  CustomBlending,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  ZeroFactor,
} from 'three';
import { FlowSimulation, SKETCH_HEIGHT, SKETCH_WIDTH, W_SHIFT } from './flow-simulation';

// three.js rendering of the Flowlab particle background (physics in
// flow-simulation.ts). Each particle is drawn as a tapered streak along its
// velocity, which becomes a round dot once it comes to rest, over a
// transparent canvas whose previous frames fade out, so movement leaves trails.
//
// The simulation's 1500×600 box is scaled to fit the viewport and centred,
// and the simulated area is widened to cover the rest of the screen.

// Particle diameters in sketch units (the word "flooow" is 350 units tall).
const PARTICLE_SIZE = 18; // once settled into the letters
const PARTICLE_SIZE_MOVING = 2; // while travelling
const MAX_PARTICLES = 3000;

// --- Visual parameters ---
// Shades of rgb(230, 57, 36): same hue and saturation, lightness 30–72%.
const PALETTE = [
  [137, 29, 16],
  [183, 38, 21],
  [230, 57, 36],
  [235, 98, 81],
  [240, 139, 127],
];
const INK = PALETTE[2];
const TRAIL_ALPHA = 35 / 255;
const STREAK_LENGTH = 3; // streak length in steps of travel
const STREAK_MIN_SPEED = 0.5; // slower particles are drawn as plain circles
const MAX_STREAK = 60;
const MIN_RADIUS_PX = 0.75; // keep fast thin particles visible on small screens
// Position is in attractor grid units, like ATTRACTOR_FLOW; it follows the "w".
const LABEL = { text: 'LAB', x: 17.65 + W_SHIFT, y: 7.8, size: 64, stroke: 5, font: 'Martian Mono, system-ui, sans-serif' };

const STEP_MS = 1000 / 60; // p5 ran at 60 fps; keep that pace on faster displays
const MAX_STEPS_PER_FRAME = 4;
const REDUCED_MOTION_STEPS = 1200;

const vertexShader = /* glsl */ `
  uniform float uStreak;
  uniform float uStreakMinSpeed;
  uniform float uMaxStreak;
  uniform float uMinRadius;
  attribute vec2 aPos;
  attribute vec2 aVel;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying vec2 vLocal;
  varying float vHalfLength;
  varying float vRadius;
  void main() {
    float speed = length(aVel);
    vec2 dir = speed > 0.0001 ? aVel / speed : vec2(1.0, 0.0);
    vec2 side = vec2(-dir.y, dir.x);
    float radius = max(aSize * 0.5, uMinRadius);
    float halfLength = min(max(speed - uStreakMinSpeed, 0.0) * uStreak, uMaxStreak) * 0.5;
    // Quad around a segment with round caps; the head sits on the particle.
    vLocal = position.xy * vec2(2.0 * (halfLength + radius), 2.0 * radius);
    vec2 p = aPos - dir * halfLength + dir * vLocal.x + side * vLocal.y;
    vColor = aColor;
    vHalfLength = halfLength;
    vRadius = radius;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, -p.y, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying vec2 vLocal;
  varying float vHalfLength;
  varying float vRadius;
  void main() {
    float along = clamp(vLocal.x, -vHalfLength, vHalfLength);
    // Taper towards the tail.
    // Taper towards the tail, fading in with streak length so slow particles stay round.
    float tail = clamp(vHalfLength / vRadius, 0.0, 1.0) * 0.65;
    float taper = vHalfLength > 0.0 ? 1.0 - tail * (1.0 - (along + vHalfLength) / (2.0 * vHalfLength)) : 1.0;
    if (length(vec2(vLocal.x - along, vLocal.y)) > vRadius * taper) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

export function startFlowBackground(canvas: HTMLCanvasElement) {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
  } catch {
    canvas.remove(); // No WebGL: the page simply has no background.
    return;
  }
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0); // the page background shows through
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const n = MAX_PARTICLES;
  const sim = new FlowSimulation(n, PARTICLE_SIZE, PARTICLE_SIZE_MOVING);
  const shade = Uint8Array.from({ length: n }, () => Math.floor(Math.random() * PALETTE.length));
  let scale = 1;
  let pointerX = -1e6;
  let pointerY = -1e6;

  // --- Scene: trail quad, then the label, then the particles ---
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 0, -1, -1, 1);

  // Fades what is already drawn towards transparent: destination × (1 − TRAIL_ALPHA).
  const trail = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      transparent: false,
      opacity: TRAIL_ALPHA,
      blending: CustomBlending,
      blendSrc: ZeroFactor,
      blendDst: OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
    }),
  );
  trail.renderOrder = 0;

  const labelCanvas = document.createElement('canvas');
  const labelMaterial = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  const label = new Mesh(new PlaneGeometry(1, 1), labelMaterial);
  label.renderOrder = 1;

  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.instanceCount = n;
  const posAttr = new InstancedBufferAttribute(new Float32Array(n * 2), 2);
  const velAttr = new InstancedBufferAttribute(new Float32Array(n * 2), 2);
  const sizeAttr = new InstancedBufferAttribute(new Float32Array(n).fill(PARTICLE_SIZE_MOVING), 1);
  const colorAttr = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  geometry.setAttribute('aPos', posAttr);
  geometry.setAttribute('aVel', velAttr);
  geometry.setAttribute('aSize', sizeAttr);
  geometry.setAttribute('aColor', colorAttr);
  const particleMaterial = new ShaderMaterial({
    uniforms: {
      uStreak: { value: STREAK_LENGTH },
      uStreakMinSpeed: { value: STREAK_MIN_SPEED },
      uMaxStreak: { value: MAX_STREAK },
      uMinRadius: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    side: DoubleSide, // the y flip mirrors the quads
    depthTest: false,
    depthWrite: false,
  });
  const particles = new Mesh(geometry, particleMaterial);
  particles.frustumCulled = false;
  particles.renderOrder = 2;

  scene.add(trail, label, particles);

  function applyColors() {
    // Particle colours are written straight to the framebuffer, so they stay in sRGB.
    const colors = colorAttr.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = PALETTE[shade[i]];
      colors[i * 3] = r / 255;
      colors[i * 3 + 1] = g / 255;
      colors[i * 3 + 2] = b / 255;
    }
    colorAttr.needsUpdate = true;
    // drawLabel();
  }

  function drawLabel() {
    const ctx = labelCanvas.getContext('2d');
    if (!ctx) return;
    const res = scale * renderer.getPixelRatio();
    const font = `${LABEL.size}px ${LABEL.font}`;
    ctx.font = font;
    const metrics = ctx.measureText(LABEL.text);
    const pad = LABEL.stroke;
    const ascent = metrics.actualBoundingBoxAscent;
    const w = metrics.width + pad * 2;
    const h = ascent + metrics.actualBoundingBoxDescent + pad * 2;

    labelCanvas.width = Math.ceil(w * res);
    labelCanvas.height = Math.ceil(h * res);
    ctx.setTransform(res, 0, 0, res, 0, 0);
    ctx.font = font;
    ctx.fillStyle = ctx.strokeStyle = `rgb(${INK.join(' ')})`;
    ctx.lineWidth = LABEL.stroke;
    ctx.fillText(LABEL.text, pad, pad + ascent);
    ctx.strokeText(LABEL.text, pad, pad + ascent);

    labelMaterial.map?.dispose();
    const texture = new CanvasTexture(labelCanvas);
    texture.colorSpace = SRGBColorSpace;
    labelMaterial.map = texture;
    labelMaterial.needsUpdate = true;

    // Place the text baseline at LABEL.x/LABEL.y, like p5's text().
    const [x, y] = sim.toSketch(LABEL.x, LABEL.y);
    label.scale.set(w, h, 1);
    label.position.set(x - pad + w / 2, -(y - ascent - pad + h / 2), 0);
  }

  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    scale = Math.min(vw / SKETCH_WIDTH, vh / SKETCH_HEIGHT);
    const width = vw / scale;
    const height = vh / scale;
    sim.layout(width, height);

    renderer.setSize(vw, vh, false);
    camera.right = width;
    camera.bottom = -height;
    camera.updateProjectionMatrix();
    trail.scale.set(width, height, 1);
    trail.position.set(width / 2, -height / 2, 0);
    particleMaterial.uniforms.uMinRadius.value = MIN_RADIUS_PX / scale;
    //drawLabel();
    renderer.clear();
  }

  function step() {
    sim.step(pointerX / scale, pointerY / scale);
  }

  function render() {
    const pos = posAttr.array as Float32Array;
    const vel = velAttr.array as Float32Array;
    for (let i = 0; i < n; i++) {
      pos[i * 2] = sim.px[i];
      pos[i * 2 + 1] = sim.py[i];
      vel[i * 2] = sim.vx[i];
      vel[i * 2 + 1] = sim.vy[i];
    }
    (sizeAttr.array as Float32Array).set(sim.size);
    posAttr.needsUpdate = true;
    velAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    renderer.render(scene, camera);
  }

  function renderStill() {
    renderer.clear();
    render();
  }

  // --- Setup ---
  resize();
  applyColors();
  document.fonts?.ready.then(() => {
    //drawLabel();
    if (reducedMotion) renderStill();
  });

  window.addEventListener('resize', () => {
    resize();
    if (reducedMotion) renderStill();
  });

  if (reducedMotion) {
    // Show the settled word without animating it.
    for (let i = 0; i < REDUCED_MOTION_STEPS; i++) step();
    renderStill();
    return;
  }

  const movePointer = (e: PointerEvent) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
  };
  const clearPointer = () => {
    pointerX = pointerY = -1e6;
  };
  window.addEventListener('pointermove', movePointer, { passive: true });
  window.addEventListener('pointerdown', movePointer, { passive: true });
  window.addEventListener('pointerup', (e) => e.pointerType !== 'mouse' && clearPointer());
  window.addEventListener('blur', clearPointer);
  document.documentElement.addEventListener('pointerleave', clearPointer);

  let last = performance.now();
  let pending = STEP_MS; // draw on the first frame
  function frame(now: number) {
    pending = Math.min(pending + now - last, STEP_MS * MAX_STEPS_PER_FRAME);
    last = now;
    // One render per step so the trail fades at the original rate.
    while (pending >= STEP_MS) {
      step();
      render();
      pending -= STEP_MS;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
