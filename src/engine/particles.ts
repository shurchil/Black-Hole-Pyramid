/**
 * A pooled particle system.
 *
 * Allocation is the enemy of a smooth 60fps on a mid-range phone, so particles
 * live in a fixed pool and are recycled rather than created. Every emitter
 * below is tuned to be short and punchy: bursts read as impact, not as fog.
 */

export interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  sizeDecay: number;
  drag: number;
  gravity: number;
  color: string;
  glow: boolean;
  /** Pulls the particle toward a point, used for the black hole implosion. */
  attractX: number;
  attractY: number;
  attract: number;
  spin: number;
  angle: number;
  shape: 'dot' | 'spark' | 'ring' | 'shard';
}

export interface EmitOptions {
  x: number;
  y: number;
  count: number;
  color: string | string[];
  speed?: [number, number];
  life?: [number, number];
  size?: [number, number];
  angle?: [number, number];
  gravity?: number;
  drag?: number;
  glow?: boolean;
  shape?: Particle['shape'];
  sizeDecay?: number;
  attract?: { x: number; y: number; strength: number };
}

const TAU = Math.PI * 2;

export class ParticleSystem {
  private pool: Particle[];
  private cursor = 0;

  constructor(readonly capacity = 600) {
    this.pool = Array.from({ length: capacity }, () => ({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 1,
      sizeDecay: 1,
      drag: 0,
      gravity: 0,
      color: '#fff',
      glow: false,
      attractX: 0,
      attractY: 0,
      attract: 0,
      spin: 0,
      angle: 0,
      shape: 'dot' as const,
    }));
  }

  /** Grabs the next slot, overwriting the oldest particle when saturated. */
  private next(): Particle {
    for (let i = 0; i < this.capacity; i++) {
      const index = (this.cursor + i) % this.capacity;
      if (!this.pool[index].alive) {
        this.cursor = (index + 1) % this.capacity;
        return this.pool[index];
      }
    }
    const fallback = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    return fallback;
  }

  emit(options: EmitOptions): void {
    const {
      x,
      y,
      count,
      color,
      speed = [60, 220],
      life = [0.35, 0.8],
      size = [2, 5],
      angle = [0, TAU],
      gravity = 0,
      drag = 1.8,
      glow = true,
      shape = 'dot',
      sizeDecay = 1,
      attract,
    } = options;

    for (let i = 0; i < count; i++) {
      const p = this.next();
      const a = rand(angle[0], angle[1]);
      const s = rand(speed[0], speed[1]);
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = rand(life[0], life[1]);
      p.life = p.maxLife;
      p.size = rand(size[0], size[1]);
      p.sizeDecay = sizeDecay;
      p.drag = drag;
      p.gravity = gravity;
      p.color = Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color;
      p.glow = glow;
      p.shape = shape;
      p.angle = a;
      p.spin = rand(-6, 6);
      p.attractX = attract?.x ?? 0;
      p.attractY = attract?.y ?? 0;
      p.attract = attract?.strength ?? 0;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }

      if (p.attract !== 0) {
        const dx = p.attractX - p.x;
        const dy = p.attractY - p.y;
        const distSq = dx * dx + dy * dy + 40;
        const pull = (p.attract * 4000) / distSq;
        p.vx += dx * pull * dt;
        p.vy += dy * pull * dt;
      }

      p.vy += p.gravity * dt;
      const damping = Math.exp(-p.drag * dt);
      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.maxLife;
      const alpha = t < 0.25 ? t / 0.25 : 1; // fade only at the very end
      const size = p.size * (p.sizeDecay === 1 ? t : Math.pow(t, p.sizeDecay));
      if (size <= 0.1) continue;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;

      if (p.glow) {
        ctx.shadowBlur = size * 3;
        ctx.shadowColor = p.color;
      } else {
        ctx.shadowBlur = 0;
      }

      switch (p.shape) {
        case 'spark': {
          const len = size * 3;
          ctx.lineWidth = Math.max(1, size * 0.6);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - Math.cos(p.angle) * len, p.y - Math.sin(p.angle) * len);
          ctx.stroke();
          break;
        }
        case 'ring':
          ctx.lineWidth = Math.max(1, size * 0.5);
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 2, 0, TAU);
          ctx.stroke();
          break;
        case 'shard':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.lineTo(size * 0.6, 0);
          ctx.lineTo(0, size);
          ctx.lineTo(-size * 0.6, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        default:
          ctx.beginPath();
          ctx.arc(p.x, p.y, size, 0, TAU);
          ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }

  get aliveCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.alive) n++;
    return n;
  }
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/* ------------------------------------------------------------------ *
 * Named effects. Keeping them here means the scene reads as a script of
 * beats ("impact, then implode, then confetti") rather than as tuning noise.
 * ------------------------------------------------------------------ */

export const Effects = {
  /** A token lands. Short, tight, directional. */
  impact(ps: ParticleSystem, x: number, y: number, color: string): void {
    ps.emit({ x, y, count: 14, color, speed: [90, 260], life: [0.25, 0.5], size: [2, 4.5], shape: 'spark' });
    ps.emit({ x, y, count: 1, color, speed: [0, 0], life: [0.35, 0.35], size: [10, 10], shape: 'ring', sizeDecay: 0.4 });
  },

  /** Illegal tap or blocked cell. */
  reject(ps: ParticleSystem, x: number, y: number): void {
    ps.emit({ x, y, count: 8, color: '#ff5470', speed: [40, 120], life: [0.2, 0.35], size: [1.5, 3], glow: true });
  },

  /** The black hole forms and drags everything nearby inward. */
  implode(ps: ParticleSystem, x: number, y: number, radius: number, colors: string[]): void {
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * TAU;
      const r = radius * (0.8 + Math.random() * 2.2);
      ps.emit({
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        count: 1,
        color: colors,
        speed: [10, 60],
        angle: [a + Math.PI * 0.5, a + Math.PI * 0.5],
        life: [0.5, 1.1],
        size: [1.5, 4],
        drag: 0.2,
        attract: { x, y, strength: 1.6 },
      });
    }
  },

  /** Score numbers being devoured, one streak per contributing cell. */
  devour(ps: ParticleSystem, fromX: number, fromY: number, toX: number, toY: number, color: string): void {
    ps.emit({
      x: fromX,
      y: fromY,
      count: 10,
      color,
      speed: [20, 80],
      life: [0.4, 0.7],
      size: [2, 4],
      drag: 0.6,
      shape: 'spark',
      attract: { x: toX, y: toY, strength: 2.4 },
    });
  },

  /** Victory. The one place elastic and confetti are allowed. */
  celebrate(ps: ParticleSystem, x: number, y: number, colors: string[]): void {
    ps.emit({
      x,
      y,
      count: 70,
      color: colors,
      speed: [180, 520],
      life: [0.7, 1.4],
      size: [3, 7],
      gravity: 900,
      drag: 0.9,
      shape: 'shard',
    });
  },

  /** A level-up or unlock pings outward. */
  pulse(ps: ParticleSystem, x: number, y: number, color: string): void {
    ps.emit({ x, y, count: 3, color, speed: [0, 0], life: [0.5, 0.7], size: [8, 14], shape: 'ring', sizeDecay: 0.3 });
    ps.emit({ x, y, count: 20, color, speed: [120, 300], life: [0.4, 0.8], size: [2, 4] });
  },
};
