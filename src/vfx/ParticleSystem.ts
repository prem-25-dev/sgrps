import * as THREE from 'three';
import { CFG } from '../core/Config';
import { paintedTexture } from '../assets/TextureFactory';

/**
 * A single points-based particle pool shared by every effect in the game.
 *
 * All particles live in one BufferGeometry and one draw call. Effects differ
 * by their emitter parameters, not by having their own systems, which is what
 * keeps twenty simultaneous effects affordable.
 */

export interface EmitParams {
  /** Emitter origin in world space. */
  x: number;
  y: number;
  z: number;
  count: number;
  /** Base velocity and the random cone added to it. */
  vx?: number;
  vy?: number;
  vz?: number;
  spread?: number;
  speed?: number;
  size: number;
  sizeVariance?: number;
  life: number;
  lifeVariance?: number;
  color: THREE.ColorRepresentation;
  colorEnd?: THREE.ColorRepresentation;
  /** Downward acceleration; 0 for smoke that hangs. */
  gravity?: number;
  drag?: number;
  /** Particles inherit this fraction of the player's forward motion. */
  inheritZ?: number;
}

const MAX = CFG.performance.maxParticles;

function sparkTexture(): THREE.Texture {
  return paintedTexture('vfx:spark', 64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, { transparent: true });
}

export class ParticleSystem {
  readonly points: THREE.Points;

  private readonly position = new Float32Array(MAX * 3);
  private readonly color = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);

  private readonly velocity = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly gravity = new Float32Array(MAX);
  private readonly drag = new Float32Array(MAX);
  private readonly startColor = new Float32Array(MAX * 3);
  private readonly endColor = new Float32Array(MAX * 3);
  private readonly baseSize = new Float32Array(MAX);

  /** Indices of dead slots, used as a free list. */
  private free: number[] = [];
  private liveCount = 0;
  private cursor = 0;

  private readonly geometry = new THREE.BufferGeometry();

  constructor() {
    for (let i = MAX - 1; i >= 0; i--) this.free.push(i);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    this.geometry.setAttribute('particleColor', new THREE.BufferAttribute(this.color, 3));
    this.geometry.setAttribute('particleSize', new THREE.BufferAttribute(this.size, 1));
    this.geometry.setAttribute('particleAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geometry.setDrawRange(0, MAX);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: sparkTexture() },
        pixelRatio: { value: 1 },
      },
      vertexShader: `
        attribute vec3 particleColor;
        attribute float particleSize;
        attribute float particleAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float pixelRatio;
        void main() {
          vColor = particleColor;
          vAlpha = particleAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = particleSize * pixelRatio * (300.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(map, gl_PointCoord);
          if (vAlpha <= 0.001) discard;
          gl_FragColor = vec4(vColor, tex.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.points.name = 'VFX_Particles';
  }

  setPixelRatio(ratio: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.pixelRatio.value = ratio;
  }

  get live(): number {
    return this.liveCount;
  }

  /** Emits a burst. Silently drops particles when the pool is exhausted. */
  emit(p: EmitParams): void {
    const start = new THREE.Color(p.color);
    const end = new THREE.Color(p.colorEnd ?? p.color);
    const spread = p.spread ?? 1;
    const speed = p.speed ?? 1;

    for (let n = 0; n < p.count; n++) {
      const i = this.free.pop();
      if (i === undefined) return;
      this.liveCount++;

      const i3 = i * 3;
      this.position[i3] = p.x;
      this.position[i3 + 1] = p.y;
      this.position[i3 + 2] = p.z;

      // Random direction in a cone around the base velocity.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - Math.random() * 2) * 0.5;
      const r = Math.sin(phi) * spread;
      this.velocity[i3] = (p.vx ?? 0) + Math.cos(theta) * r * speed;
      this.velocity[i3 + 1] = (p.vy ?? 0) + Math.cos(phi) * spread * speed;
      this.velocity[i3 + 2] = (p.vz ?? 0) + Math.sin(theta) * r * speed;

      const life = p.life * (1 + (Math.random() - 0.5) * (p.lifeVariance ?? 0.4));
      this.life[i] = life;
      this.maxLife[i] = life;
      this.gravity[i] = p.gravity ?? -9;
      this.drag[i] = p.drag ?? 0.6;
      this.baseSize[i] = p.size * (1 + (Math.random() - 0.5) * (p.sizeVariance ?? 0.5));

      this.startColor[i3] = start.r;
      this.startColor[i3 + 1] = start.g;
      this.startColor[i3 + 2] = start.b;
      this.endColor[i3] = end.r;
      this.endColor[i3 + 1] = end.g;
      this.endColor[i3 + 2] = end.b;

      this.color[i3] = start.r;
      this.color[i3 + 1] = start.g;
      this.color[i3 + 2] = start.b;
      this.size[i] = this.baseSize[i];
      this.alpha[i] = 1;
    }
    this.markDirty();
  }

  /**
   * `worldShift` is how far the player advanced this frame: particles are
   * emitted in player-relative space and drift backwards with the world.
   */
  update(dt: number, worldShift: number): void {
    if (this.liveCount === 0) return;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        this.free.push(i);
        this.liveCount--;
        continue;
      }
      const i3 = i * 3;
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.velocity[i3] *= damp;
      this.velocity[i3 + 1] = this.velocity[i3 + 1] * damp + this.gravity[i] * dt;
      this.velocity[i3 + 2] *= damp;

      this.position[i3] += this.velocity[i3] * dt;
      this.position[i3 + 1] += this.velocity[i3 + 1] * dt;
      this.position[i3 + 2] += this.velocity[i3 + 2] * dt + worldShift;

      const t = 1 - this.life[i] / this.maxLife[i];
      this.color[i3] = this.startColor[i3] + (this.endColor[i3] - this.startColor[i3]) * t;
      this.color[i3 + 1] = this.startColor[i3 + 1] + (this.endColor[i3 + 1] - this.startColor[i3 + 1]) * t;
      this.color[i3 + 2] = this.startColor[i3 + 2] + (this.endColor[i3 + 2] - this.startColor[i3 + 2]) * t;
      // Fade out on a curve so the tail is soft rather than a hard cut.
      this.alpha[i] = Math.pow(1 - t, 1.6);
      this.size[i] = this.baseSize[i] * (0.6 + (1 - t) * 0.6);
    }
    this.markDirty();
  }

  private markDirty(): void {
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('particleColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('particleSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('particleAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] > 0) {
        this.life[i] = 0;
        this.free.push(i);
      }
      this.alpha[i] = 0;
      this.size[i] = 0;
    }
    this.liveCount = 0;
    this.cursor = 0;
    void this.cursor;
    this.markDirty();
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
