// Particle physics for the homepage background, kept free of DOM and three.js
// so it can be run and tuned on its own.
//
// Units are the original p5 sketch's pixels; y grows downwards. Particles drift
// on a slowly changing current, are released towards their letter from left
// to right, are pulled in by G / d^2, and ease onto their spot with a damped
// spring so they settle instead of overshooting.

// --- Layout ---
export const DOT_DIST = 70;
export const ATTRACTOR_X_OFFSET = 1.2;
export const ATTRACTOR_Y_OFFSET = 1.5;
export const SKETCH_HEIGHT = 600;

// --- Attraction ---
const G_START = 2;
const G_MAX = 15000;
const PARTICLE_MAX_SPEED = 40;
const PARTICLE_DAMPING = 0.95;
// Inside ARRIVE_RADIUS the G / d^2 pull is replaced by a damped spring.
const ARRIVE_RADIUS = 30;
const SPRING = 0.02;
const ARRIVE_DAMPING = 0.7;
// A particle may close at most this fraction of the remaining distance per
// step, so it slows down on approach and never shoots past its spot.
const APPROACH_RATE = 0.2;
const SETTLE_DISTANCE = 10;

// --- Shape and timing ---
const STROKE_RADIUS = 30; // particles spread around each point to form thick strokes
const WRITE_STEPS = 150; // steps between releasing the first and the last letter
const RELEASE_JITTER = 30;

// --- Current (curl of a smooth, moving potential) ---
const FLOW_SCALE = 0.006; // spatial frequency of the large swirls
const FLOW_DETAIL = 2.3; // frequency ratio of the smaller swirls
const FLOW_TIME = 0.01; // how fast the current changes, per step
const FLOW_FORCE_FREE = 0.08; // before release
const FLOW_FORCE_TRAVEL = 0.04; // on the way to the letter
const FLOW_FORCE_SETTLED = 0.03; // keeps settled letters gently breathing

// --- Pointer and walls ---
const MOUSE_REPULSION_FACTOR = 7000;
const MOUSE_REPULSION_AREA_SQ = 5000;
const WALL_BOUNCE_FACTOR = -0.85;
const EDGE_BUFFER = 5;

// --- Size ---
const SIZE_EASE = 0.05;

// Letter shapes in grid units (multiplied by DOT_DIST).
const LETTER_F: [number, number][] = [[2.25, 2.25], [2, 2.5], [2.5, 2], [2, 3], [2, 3.5], [2, 4], [2, 4.5], [1, 5], [1.5, 5], [2, 5], [2.5, 5], [3, 5], [2, 5.5], [2, 6], [2, 6.5], [2, 7], [1.5, 7.5], [3, 2]];
const LETTER_L: [number, number][] = [[5, 1], [5.5, 1], [5, 1.5], [5, 2], [5, 2.5], [5, 3], [5, 3.5], [5, 4], [5, 4.5], [5, 5], [5, 5.5], [5, 6], [4.5, 6], [5.5, 6]];
const LETTER_O: [number, number][] = [[7, 5], [7.15, 4.5], [7.75, 4.15], [8.75, 4.5], [8.15, 4.15], [8, 4], [8, 6], [7.15, 5.5], [7.75, 5.75], [8.75, 5.5], [8.15, 5.75], [9, 5]];
const LETTER_W: [number, number][] = [[16, 4], [16.3, 4.5], [16.6, 5], [16.9, 5.5], [17.2, 6], [17.7, 5.5], [18, 5], [18.3, 5.5], [19, 6], [19, 5.5], [19.3, 5.5], [19.6, 5], [19.9, 4.5], [20.2, 4]];

// Added to the gap after the "l" and between the "o"s, in grid units; the "w"
// moves left with them.
export const O_SPACING = -0.5;
// How far the "w" has moved, for placing things relative to it.
export const W_SHIFT = 3 * O_SPACING;

const shiftX = (points: [number, number][], dx: number) => points.map(([x, y]): [number, number] => [x + dx, y]);

export const ATTRACTOR_FLOW: [number, number][] = [
  ...LETTER_F,
  ...shiftX(LETTER_L, -.5),
  ...shiftX(LETTER_O, -1),
  ...shiftX(LETTER_O, 2.25),
  ...shiftX(LETTER_O, 5.5),
  ...shiftX(LETTER_W, -.5),
];

// Wide enough for the word with equal margins on both sides.
const xs = ATTRACTOR_FLOW.map(([x]) => x);
export const SKETCH_WIDTH = 2 * ATTRACTOR_X_OFFSET + (Math.min(...xs) + Math.max(...xs)) * DOT_DIST;

export class FlowSimulation {
  readonly n: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly size: Float32Array;
  readonly settled: Uint8Array;
  private readonly target: Uint16Array;
  private readonly ox: Float32Array;
  private readonly oy: Float32Array;
  private readonly releaseAt: Uint16Array;
  private readonly ax = new Float32Array(ATTRACTOR_FLOW.length);
  private readonly ay = new Float32Array(ATTRACTOR_FLOW.length);
  private G = G_START;
  private steps = 0;
  private width = SKETCH_WIDTH;
  private height = SKETCH_HEIGHT;
  private offsetX = 0;
  private offsetY = 0;
  private readonly settledSize: number;
  private readonly movingSize: number;

  /** Sizes are particle diameters in sketch units, at rest and while travelling. */
  constructor(n: number, settledSize: number, movingSize: number, random: () => number = Math.random) {
    this.n = n;
    this.settledSize = settledSize;
    this.movingSize = movingSize;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.size = new Float32Array(n).fill(movingSize);
    this.settled = new Uint8Array(n);
    this.target = new Uint16Array(n);
    this.ox = new Float32Array(n);
    this.oy = new Float32Array(n);
    this.releaseAt = new Uint16Array(n);

    const xs = ATTRACTOR_FLOW.map(([x]) => x);
    const minX = Math.min(...xs);
    const spanX = Math.max(...xs) - minX;
    for (let i = 0; i < n; i++) {
      const t = i % ATTRACTOR_FLOW.length;
      this.target[i] = t;
      this.px[i] = random() * this.width;
      this.py[i] = random() * this.height;
      // Uniform point in a disc around the attractor.
      const r = STROKE_RADIUS * Math.sqrt(random());
      const a = random() * Math.PI * 2;
      this.ox[i] = r * Math.cos(a);
      this.oy[i] = r * Math.sin(a);
      this.releaseAt[i] = Math.round(((xs[t] - minX) / spanX) * WRITE_STEPS + random() * RELEASE_JITTER);
    }
    this.layout(this.width, this.height);
  }

  /** Resize the simulated area, keeping the word centred in it (moved down by shiftY). */
  layout(width: number, height: number, shiftY = 0) {
    const offsetX = (width - SKETCH_WIDTH) / 2;
    const offsetY = (height - SKETCH_HEIGHT) / 2 + shiftY;
    for (let i = 0; i < this.n; i++) {
      this.px[i] += offsetX - this.offsetX;
      this.py[i] += offsetY - this.offsetY;
    }
    this.width = width;
    this.height = height;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    ATTRACTOR_FLOW.forEach(([x, y], i) => {
      this.ax[i] = offsetX + ATTRACTOR_X_OFFSET + x * DOT_DIST;
      this.ay[i] = offsetY + ATTRACTOR_Y_OFFSET + y * DOT_DIST;
    });
  }

  /** Convert attractor grid units to simulation coordinates. */
  toSketch(gridX: number, gridY: number): [number, number] {
    return [
      this.offsetX + ATTRACTOR_X_OFFSET + gridX * DOT_DIST,
      this.offsetY + ATTRACTOR_Y_OFFSET + gridY * DOT_DIST,
    ];
  }

  /** Advance one step (1/60 s). Pass a far-away pointer when there is none. */
  step(pointerX: number, pointerY: number) {
    if (this.G < G_MAX) this.G += this.G > 1000 ? 100 : 10;
    this.steps++;
    const time = this.steps * FLOW_TIME;
    const { px, py, vx, vy, size, settled, G } = this;

    for (let i = 0; i < this.n; i++) {
      const released = this.steps >= this.releaseAt[i];
      const dx = this.ax[this.target[i]] + this.ox[i] - px[i];
      const dy = this.ay[this.target[i]] + this.oy[i] - py[i];
      const dist = Math.sqrt(dx * dx + dy * dy);
      const arriving = released && dist < ARRIVE_RADIUS;
      let accX = 0;
      let accY = 0;

      if (arriving) {
        accX = dx * SPRING;
        accY = dy * SPRING;
        if (dist < SETTLE_DISTANCE) settled[i] = 1;
      } else if (released) {
        // Attraction towards the target (G / d^2), as in the original sketch.
        const d = Math.min(Math.max(dist, 2), 500);
        const strength = G / (d * d);
        accX = (dx / d) * strength;
        accY = (dy / d) * strength;
      }

      // Ride the current.
      const flowForce = settled[i] ? FLOW_FORCE_SETTLED : released ? FLOW_FORCE_TRAVEL : FLOW_FORCE_FREE;
      const a = px[i] * FLOW_SCALE + time;
      const b = py[i] * FLOW_SCALE * 1.3 - time * 0.8;
      const c = (px[i] * 0.7 - py[i]) * FLOW_SCALE * FLOW_DETAIL + time * 1.3;
      // Potential: sin(a)cos(b) + 0.5 sin(c). Velocity is its curl, so the current has no sinks.
      const dPsiDx = Math.cos(a) * Math.cos(b) + 0.35 * FLOW_DETAIL * Math.cos(c);
      const dPsiDy = -1.3 * Math.sin(a) * Math.sin(b) - 0.5 * FLOW_DETAIL * Math.cos(c);
      accX += dPsiDy * flowForce;
      accY -= dPsiDx * flowForce;

      // Pointer repulsion.
      const mx = px[i] - pointerX;
      const my = py[i] - pointerY;
      const mSq = mx * mx + my * my;
      if (mSq < MOUSE_REPULSION_AREA_SQ && mSq > 0) {
        const strength = MOUSE_REPULSION_FACTOR / mSq;
        const m = Math.sqrt(mSq);
        accX += (mx / m) * strength;
        accY += (my / m) * strength;
      }

      // Integrate: add acceleration, limit speed, damp.
      let velX = vx[i] + accX;
      let velY = vy[i] + accY;
      const speedSq = velX * velX + velY * velY;
      if (speedSq > PARTICLE_MAX_SPEED * PARTICLE_MAX_SPEED) {
        const k = PARTICLE_MAX_SPEED / Math.sqrt(speedSq);
        velX *= k;
        velY *= k;
      }
      const damping = arriving ? ARRIVE_DAMPING : PARTICLE_DAMPING;
      velX *= damping;
      velY *= damping;

      // Brake the approach so the particle eases in instead of overshooting.
      if (released && dist > 0) {
        const closing = (velX * dx + velY * dy) / dist;
        const maxClosing = dist * APPROACH_RATE;
        if (closing > maxClosing) {
          const k = (closing - maxClosing) / dist;
          velX -= dx * k;
          velY -= dy * k;
        }
      }

      let x = px[i] + velX;
      let y = py[i] + velY;

      // Soft bounce off the edges.
      if (x < EDGE_BUFFER) {
        velX *= WALL_BOUNCE_FACTOR;
        x = EDGE_BUFFER;
      } else if (x > this.width - EDGE_BUFFER) {
        velX *= WALL_BOUNCE_FACTOR;
        x = this.width - EDGE_BUFFER;
      }
      if (y < EDGE_BUFFER) {
        velY *= WALL_BOUNCE_FACTOR;
        y = EDGE_BUFFER;
      } else if (y > this.height - EDGE_BUFFER) {
        velY *= WALL_BOUNCE_FACTOR;
        y = this.height - EDGE_BUFFER;
      }

      vx[i] = velX;
      vy[i] = velY;
      px[i] = x;
      py[i] = y;
      size[i] += ((settled[i] ? this.settledSize : this.movingSize) - size[i]) * SIZE_EASE;
    }
  }
}
