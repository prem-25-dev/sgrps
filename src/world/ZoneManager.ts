import * as THREE from 'three';
import { ZONES, zoneAt } from '../../data/difficulty/zones';
import { setNeonIntensity } from '../assets/MaterialLibrary';
import { bus } from '../core/EventBus';
import { ZoneDef } from '../core/Types';
import { AmbienceId, AudioManager } from '../audio/AudioManager';

/**
 * Owns the look of the world: sky, fog, key light, ambient, neon response
 * and the ambience mix. Zones cross-fade over 240 m so the change reads as
 * travelling somewhere rather than a hard cut.
 */

const AMBIENCE_BY_ZONE: Record<string, Partial<Record<AmbienceId, number>>> = {
  ZONE_CityEdge: { AMB_Wind: 0.5, AMB_City: 0.2, AMB_Railway: 0.25 },
  ZONE_Metro: { AMB_Railway: 0.55, AMB_City: 0.35, AMB_Crowd: 0.3, AMB_Electrical: 0.15 },
  ZONE_Downtown: { AMB_City: 0.6, AMB_Crowd: 0.4, AMB_Railway: 0.25 },
  ZONE_Industrial: { AMB_Machinery: 0.6, AMB_Railway: 0.3, AMB_Electrical: 0.25 },
  ZONE_Elevated: { AMB_Wind: 0.6, AMB_City: 0.3, AMB_Railway: 0.3 },
  ZONE_Construction: { AMB_Machinery: 0.55, AMB_City: 0.25, AMB_Wind: 0.2 },
  ZONE_Neon: { AMB_City: 0.45, AMB_Electrical: 0.45, AMB_Crowd: 0.35 },
};

export class LightingRig {
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  readonly sky: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(-40, 60, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 120;
    this.sun.shadow.camera.left = -22;
    this.sun.shadow.camera.right = 22;
    this.sun.shadow.camera.top = 26;
    this.sun.shadow.camera.bottom = -18;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.ambient = new THREE.HemisphereLight(0xbfd4e6, 0x30302c, 1.0);
    scene.add(this.ambient);

    // A cool rim from behind separates the hero from the background.
    this.fill = new THREE.DirectionalLight(0x9fc2ff, 0.55);
    this.fill.position.set(26, 18, -34);
    scene.add(this.fill);

    // Sky dome: a vertical gradient, cheap and always behind everything.
    const skyGeo = new THREE.SphereGeometry(400, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(0x74a7d8) },
        bottom: { value: new THREE.Color(0xdfe9f2) },
      },
      vertexShader: `
        varying float vH;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vH = normalize(world.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 bottom;
        varying float vH;
        void main() {
          float t = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottom, top, pow(t, 0.85)), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.name = 'ENV_Sky';
    this.sky.frustumCulled = false;
    scene.add(this.sky);
  }

  setShadows(enabled: boolean): void {
    this.sun.castShadow = enabled;
  }

  setShadowQuality(size: number): void {
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }
}

export class ZoneManager {
  private currentId = '';
  private readonly fogColor = new THREE.Color();
  private readonly skyTop = new THREE.Color();
  private readonly skyBottom = new THREE.Color();
  private readonly sunColor = new THREE.Color();
  private readonly ambientColor = new THREE.Color();
  private readonly sunPosition = new THREE.Vector3();
  private neon = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly rig: LightingRig,
    private readonly audio: AudioManager,
  ) {
    this.scene.fog = new THREE.Fog(0xbfd4e6, 60, 320);
    this.apply(ZONES[0], ZONES[0], 0, 1);
    this.currentId = ZONES[0].id;
  }

  /** Called each frame with the run distance. */
  update(dt: number, distance: number): void {
    const { zone, next, blend } = zoneAt(distance);
    const smoothing = 1 - Math.exp(-dt / 0.9);
    this.apply(zone, next, blend, smoothing);

    if (zone.id !== this.currentId) {
      this.currentId = zone.id;
      bus.emit('zone:changed', { id: zone.id, label: zone.label });
      this.audio.setAmbience(AMBIENCE_BY_ZONE[zone.id] ?? {});
    }
  }

  private apply(a: ZoneDef, b: ZoneDef, t: number, smoothing: number): void {
    const lerpColor = (target: THREE.Color, ca: number, cb: number) => {
      target.set(ca).lerp(new THREE.Color(cb), t);
    };

    lerpColor(this.fogColor, a.fog.color, b.fog.color);
    lerpColor(this.skyTop, a.sky.top, b.sky.top);
    lerpColor(this.skyBottom, a.sky.bottom, b.sky.bottom);
    lerpColor(this.sunColor, a.sun.color, b.sun.color);
    lerpColor(this.ambientColor, a.ambient.color, b.ambient.color);

    const fog = this.scene.fog as THREE.Fog;
    fog.color.lerp(this.fogColor, smoothing);
    fog.near += (a.fog.near + (b.fog.near - a.fog.near) * t - fog.near) * smoothing;
    fog.far += (a.fog.far + (b.fog.far - a.fog.far) * t - fog.far) * smoothing;

    const skyMat = this.rig.sky.material as THREE.ShaderMaterial;
    (skyMat.uniforms.top.value as THREE.Color).lerp(this.skyTop, smoothing);
    (skyMat.uniforms.bottom.value as THREE.Color).lerp(this.skyBottom, smoothing);

    this.rig.sun.color.lerp(this.sunColor, smoothing);
    this.rig.sun.intensity += (a.sun.intensity + (b.sun.intensity - a.sun.intensity) * t - this.rig.sun.intensity) * smoothing;
    this.sunPosition.set(
      a.sun.position[0] + (b.sun.position[0] - a.sun.position[0]) * t,
      a.sun.position[1] + (b.sun.position[1] - a.sun.position[1]) * t,
      a.sun.position[2] + (b.sun.position[2] - a.sun.position[2]) * t,
    );
    this.rig.sun.position.lerp(this.sunPosition, smoothing);

    this.rig.ambient.color.lerp(this.ambientColor, smoothing);
    this.rig.ambient.intensity += (a.ambient.intensity + (b.ambient.intensity - a.ambient.intensity) * t - this.rig.ambient.intensity) * smoothing;
    this.rig.ambient.groundColor.lerp(this.fogColor, smoothing * 0.5);

    // Emissive materials lift as daylight drops, so neon reads at night and
    // does not blow out at midday.
    const targetNeon = a.neon + (b.neon - a.neon) * t;
    this.neon += (targetNeon - this.neon) * smoothing;
    setNeonIntensity(0.35 + this.neon * 1.5);
  }

  /** Keeps the sky and shadow frustum centred on the player. */
  follow(x: number, y: number): void {
    this.rig.sky.position.set(x * 0.2, 0, 0);
    this.rig.sun.target.position.set(x, y, -14);
    this.rig.sun.target.updateMatrixWorld();
    this.rig.sun.position.copy(this.sunPosition).add(new THREE.Vector3(x, y, -14));
  }

  get zoneId(): string {
    return this.currentId;
  }
}
