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

/**
 * How far the ground sits below the running surface. The ballast trapezoid
 * descends 0.34 m, so this puts the terrain a few centimetres under its base:
 * enough that the embankment sides stay visible, not so much that the track
 * looks stilted.
 */
const GROUND_DROP = 0.4;

export class LightingRig {
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  /** Rides the nearest oncoming train; dark when there is none. */
  readonly headlight: THREE.SpotLight;
  private headlightLevel = 0;
  readonly sky: THREE.Mesh;
  readonly ground: THREE.Mesh;

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

    // The oncoming service train's headlight.
    //
    // The train has carried emissive lamps on its nose since it was modelled,
    // and an emissive material lights nothing: the one hazard that closes on
    // the player faster than anything else announced itself with two dull
    // spots. This is a real light, and it is allocated once here rather than
    // parented to the train, because a light that streams in and out with a
    // pooled object changes the scene's light count, and three.js recompiles
    // every shader when that happens. One light, moved onto whichever train is
    // nearest and dimmed to nothing when there is none.
    // It is parked by intensity, never by `visible`: the renderer skips
    // invisible objects entirely, so hiding a light drops it from the light
    // count and costs exactly the recompile this design avoids.
    this.headlight = new THREE.SpotLight(0xfff2d0, 0, 150, 0.42, 0.45, 1.1);
    this.headlight.name = 'ENV_TrainHeadlight';
    this.headlight.position.set(0, 2.2, 90);
    this.headlight.target.position.set(0, 0, 0);
    scene.add(this.headlight);
    scene.add(this.headlight.target);

    // Sky dome: a vertical gradient, cheap and always behind everything.
    const skyGeo = new THREE.SphereGeometry(400, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(0x74a7d8) },
        bottom: { value: new THREE.Color(0xdfe9f2) },
        // Kept equal to the fog colour so the sky just above the horizon is
        // the same colour the ground fades to just below it.
        horizon: { value: new THREE.Color(0xbfd4e6) },
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
        uniform vec3 horizon;
        varying float vH;
        void main() {
          float t = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
          vec3 base = mix(bottom, top, pow(t, 0.85));
          // Aerial perspective. At the horizon the raw gradient is already
          // halfway to the zenith colour, while the ground has faded all the
          // way to the fog colour — which left a bright band along the skyline
          // where the two met. Pulling the sky toward the fog colour as it
          // approaches the horizon makes the seam disappear.
          float haze = pow(1.0 - clamp(abs(vH) / 0.30, 0.0, 1.0), 1.4);
          gl_FragColor = vec4(mix(base, horizon, haze), 1.0);
          // THREE.Color holds these in the linear working space, and a custom
          // ShaderMaterial gets no output conversion unless it asks for one.
          // Writing them raw published linear values as if they were sRGB, so
          // the sky rendered ~60 levels darker than the same colour on the
          // ground: the horizon blend above was computing the right answer and
          // then displaying the wrong one, leaving the exact hard seam it was
          // written to remove.
          #include <colorspace_fragment>
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

    // Ground plane. One draw call, and it never has to move: the player never
    // advances in world Z — distance is a scalar and the world is drawn
    // relative to it — so a plane centred on the origin stays under the camera
    // for the whole run, however far that run goes.
    //
    // It sits just under the base of the ballast trapezoid so the embankment
    // reads as sitting on terrain rather than hovering over it, and it is wide
    // enough to reach past the farthest fog distance any zone uses, which is
    // what keeps its edge from ever being visible.
    const groundGeo = new THREE.PlaneGeometry(1600, 1600);
    groundGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshLambertMaterial({ color: 0x6c7a5e }),
    );
    this.ground.name = 'ENV_Ground';
    this.ground.position.y = -GROUND_DROP;
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    scene.add(this.ground);
  }

  /**
   * Keeps the sky dome inside the camera's far plane.
   *
   * The dome is a fixed 400 m sphere, but `camera.far` is scaled by the
   * quality profile — 378 m on medium and 315 m on low. Anything past the far
   * plane is clipped, so on those profiles most of the dome simply vanished
   * and the sky rendered as a large black void. Scaling it to sit comfortably
   * inside the frustum costs nothing: it is a background gradient, so its
   * actual radius is irrelevant as long as it encloses the camera and stays
   * behind everything else.
   */
  fitTo(far: number): void {
    const radius = (this.sky.geometry as THREE.SphereGeometry).parameters.radius;
    this.sky.scale.setScalar(Math.max(0.05, (far * 0.85) / radius));
  }

  /**
   * Puts the headlight on an oncoming train's nose, aimed down the track at
   * the player. Pass null when no train is near and it fades to nothing.
   *
   * The beam brightens as the train closes, so a train 140 m out is a glow on
   * the ballast and one at 20 m is glare — the distance is readable before the
   * shape is.
   */
  aimHeadlight(nose: { x: number; z: number } | null, dt: number): void {
    const target = nose ? Math.min(1, Math.max(0, 1 - (nose.z - 6) / 120)) : 0;
    // Eased rather than snapped: the nearest train changes the instant one is
    // recycled, and a light that jumps between lanes reads as a flicker. It
    // drops away faster than it comes up, because the position it is fading
    // from belongs to a train that is no longer there.
    //
    // Framed off dt rather than off the frame: a per-frame fraction fades in a
    // quarter of a second at 60 fps and instantly at the 1 fps a software
    // rasteriser manages, which is the same trap the browser suites keep
    // falling into with fixed waits.
    const rate = nose ? 7 : 24;
    this.headlightLevel += (target - this.headlightLevel) * (1 - Math.exp(-rate * dt));
    if (this.headlightLevel < 0.004) this.headlightLevel = 0;
    if (nose) {
      this.headlight.position.set(nose.x, 1.35, nose.z - 0.3);
      this.headlight.target.position.set(nose.x, 0.2, nose.z - 26);
      this.headlight.target.updateMatrixWorld();
    }
    this.headlight.intensity = this.headlightLevel * 240;
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
  private readonly groundColor = new THREE.Color();
  private readonly sunPosition = new THREE.Vector3();
  private neon = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly rig: LightingRig,
    private readonly audio: AudioManager,
    private readonly renderer?: THREE.WebGLRenderer,
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
    lerpColor(this.groundColor, a.ground, b.ground);

    const fog = this.scene.fog as THREE.Fog;
    fog.color.lerp(this.fogColor, smoothing);
    // Clearing to the fog colour rather than black means anything that does
    // fall outside the far plane — on a low quality profile the far plane can
    // sit inside a zone's fog distance — blends into the haze instead of
    // punching a hole in it.
    this.renderer?.setClearColor(fog.color, 1);
    fog.near += (a.fog.near + (b.fog.near - a.fog.near) * t - fog.near) * smoothing;
    fog.far += (a.fog.far + (b.fog.far - a.fog.far) * t - fog.far) * smoothing;

    const skyMat = this.rig.sky.material as THREE.ShaderMaterial;
    (skyMat.uniforms.top.value as THREE.Color).lerp(this.skyTop, smoothing);
    (skyMat.uniforms.bottom.value as THREE.Color).lerp(this.skyBottom, smoothing);
    (skyMat.uniforms.horizon.value as THREE.Color).lerp(this.fogColor, smoothing);

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

    // The terrain cross-fades with everything else, so a zone change reads as
    // one continuous move rather than the ground snapping under a blended sky.
    (this.rig.ground.material as THREE.MeshLambertMaterial).color.lerp(
      this.groundColor, smoothing,
    );

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
