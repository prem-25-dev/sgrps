import * as THREE from 'three';
import { prewarmMaterials } from '../assets/MaterialLibrary';
import { createHero, Hero } from '../assets/HeroFactory';
import { makeIdentity } from '../assets/HeroIdentity';
import { AudioManager } from '../audio/AudioManager';
import { CameraController } from '../camera/CameraController';
import { CollectibleManager } from '../collectibles/CollectibleManager';
import { InputManager } from '../player/InputManager';
import { PlayerAnimator } from '../player/PlayerAnimator';
import { PlayerController } from '../player/PlayerController';
import { PowerUpManager } from '../powerups/PowerUpManager';
import { DifficultyManager } from '../procedural/DifficultyManager';
import { ProceduralGenerator } from '../procedural/ProceduralGenerator';
import { AchievementManager, MissionManager } from '../progression/MissionManager';
import { RunStats, ScoreManager } from '../progression/ScoreManager';
import { SaveManager, Settings } from '../save/SaveManager';
import { UIManager } from '../ui/UIManager';
import { VFXManager } from '../vfx/VFXManager';
import { TrackManager } from '../world/TrackManager';
import { LightingRig, ZoneManager } from '../world/ZoneManager';
import { CFG } from './Config';
import { CollisionSystem, HitResult, ActiveObstacle } from './CollisionSystem';
import { bus } from './EventBus';
import { GameStateManager } from './GameStateManager';
import { GameState } from './Types';
import { Tutorial } from './Tutorial';

/**
 * GameManager: owns the renderer, the systems, and the frame loop.
 *
 * The update order matters — input, player, world streaming, collisions,
 * collectibles, scoring, camera, then render — so every system sees a
 * consistent view of the frame.
 */

const QUALITY_PROFILE = {
  low: { pixelRatio: 1.0, shadowSize: 0, decorDensity: 0.5, viewScale: 0.75, particleScale: 0.5 },
  medium: { pixelRatio: 1.25, shadowSize: 1024, decorDensity: 0.8, viewScale: 0.9, particleScale: 0.8 },
  high: { pixelRatio: 2.0, shadowSize: 2048, decorDensity: 1.0, viewScale: 1.0, particleScale: 1.0 },
} as const;

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CFG.camera.baseFov, 1, CFG.camera.near, CFG.camera.far);
  readonly renderer: THREE.WebGLRenderer;

  private readonly state = new GameStateManager();
  private readonly save = new SaveManager();
  private readonly audio: AudioManager;
  private readonly input = new InputManager();
  private readonly collision = new CollisionSystem();
  private readonly difficulty = new DifficultyManager();
  private readonly score = new ScoreManager();
  private readonly missions: MissionManager;
  private readonly achievements: AchievementManager;
  private readonly coins = new CollectibleManager();
  private readonly powerUps = new PowerUpManager();
  private readonly vfx = new VFXManager();
  private readonly generator: ProceduralGenerator;
  private readonly track: TrackManager;
  private readonly cameraController: CameraController;
  private readonly lighting: LightingRig;
  private readonly zones: ZoneManager;
  private readonly ui: UIManager;
  private readonly tutorial: Tutorial;

  private hero!: Hero;
  private animator!: PlayerAnimator;
  private player!: PlayerController;

  private readonly playerRoot = new THREE.Group();
  private lastTime = 0;
  private running = false;
  private frameHandle = 0;
  private seed = Date.now() >>> 0;

  // Frame timing for the performance readout.
  private fpsSamples: number[] = [];
  private fpsTimer = 0;
  private lastFrameMs = 0;
  /** Rolling average used to drop quality automatically on weak hardware. */
  private slowFrames = 0;
  private autoQualityApplied = false;
  /** Set when the pause was entered mid-tutorial, so resume restores it. */
  private pausedFromTutorial = false;
  /** Results held back until the death animation finishes. */
  private pendingResults: {
    stats: RunStats; isBestScore: boolean; isBestDistance: boolean;
    completed: Array<{ label: string; reward: number }>; unlocked: Array<{ label: string }>;
  } | null = null;
  private resultsCountdown = 0;
  /** True from the moment of death, so no further score is banked. */
  private scoringFrozen = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.audio = new AudioManager(this.save);
    this.tutorial = new Tutorial(this.save);
    this.missions = new MissionManager(this.save);
    this.achievements = new AchievementManager(this.save);
    this.generator = new ProceduralGenerator(this.seed, this.difficulty);
    this.track = new TrackManager(this.generator, this.collision, this.coins, this.powerUps);
    this.cameraController = new CameraController(this.camera);
    this.lighting = new LightingRig(this.scene);
    this.zones = new ZoneManager(this.scene, this.lighting, this.audio, this.renderer);

    this.scene.add(this.track.root);
    this.scene.add(this.coins.mesh);
    this.scene.add(this.powerUps.root);
    this.scene.add(this.vfx.root);
    this.scene.add(this.playerRoot);

    this.ui = new UIManager(container, this.save, this.missions, this.achievements, this.audio, {
      onPlay: () => this.startRun(),
      onResume: () => this.resume(),
      onRestart: () => this.startRun(),
      onHome: () => this.goHome(),
      onOpen: (panel) => this.openPanel(panel),
      onClosePanel: () => this.closePanel(),
      onSettingChange: (patch) => this.applySettings(patch),
    });

    this.bindWindowEvents();
  }

  // ------------------------------------------------------------------- Boot

  async boot(): Promise<void> {
    this.state.set(GameState.LOADING);
    this.ui.onState(GameState.LOADING);

    // Yield between phases so the loading bar actually paints.
    const step = async (fraction: number, label: string) => {
      this.ui.setLoadingProgress(fraction, label);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    };

    await step(0.05, 'Generating materials');
    prewarmMaterials();

    await step(0.35, 'Building the runner');
    this.hero = createHero(makeIdentity());
    this.playerRoot.add(this.hero.object);
    this.animator = new PlayerAnimator(this.hero);
    this.player = new PlayerController(this.hero, this.animator, this.collision, this.input, {
      onHit: (hit) => this.handleHit(hit),
      onNearMiss: (obstacle) => this.handleNearMiss(obstacle),
      onDeath: (cause) => this.handleDeath(cause),
    });

    await step(0.6, 'Laying track');
    this.track.reset(this.seed);
    this.track.update(0, 0, CFG.speed.base);

    await step(0.85, 'Tuning the world');
    this.applyQuality();
    // Persisted control preferences have to be pushed into the input layer at
    // boot; applySettings alone means they are ignored until something is
    // toggled.
    this.input.settings.invertVertical = this.save.settings.invertSwipe;
    this.input.attach();
    this.input.on((action) => {
      if (action === 'pause') this.togglePause();
      if (action === 'confirm' && this.state.is(GameState.MAIN_MENU)) this.startRun();
      void this.audio.start();
    });
    this.resize();

    await step(1, 'Ready');
    this.state.set(GameState.MAIN_MENU);
    this.ui.onState(GameState.MAIN_MENU);
    this.animator.play('menuIdle', true);
    this.start();
  }

  // ------------------------------------------------------------- Run control

  private startRun(): void {
    void this.audio.start().then(() => {
      this.audio.setMusic('gameplay');
      this.audio.setIntensity(0);
    });

    this.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.difficulty.reset();
    this.generator.reset(this.seed);
    this.track.reset(this.seed);
    this.score.reset();
    this.missions.startRun();
    this.powerUps.reset();
    this.vfx.reset();
    this.cameraController.reset();
    this.player.reset();
    this.ui.resetHud();
    this.pendingResults = null;
    this.resultsCountdown = 0;
    this.scoringFrozen = false;

    // Prime the world so the first frame is already populated.
    this.track.update(0, 0, CFG.speed.base);

    // A first-time player gets the tutorial: a real run, with prompts.
    const teaching = this.tutorial.shouldRun;
    if (teaching) {
      this.tutorial.start();
      this.difficulty.setCeiling(this.tutorial.difficultyCeiling);
    } else {
      this.tutorial.finish();
      this.difficulty.setCeiling(1);
    }
    const target = teaching ? GameState.TUTORIAL : GameState.PLAYING;
    this.state.set(target);
    this.ui.onState(target);
    bus.emit('run:start', { seed: this.seed });
  }

  private handleHit(hit: HitResult): boolean {
    this.audio.play(hit.obstacle.def.sfx as never ?? 'SFX_Collision');
    if (this.powerUps.consumeShield()) {
      this.audio.play('SFX_ShieldHit');
      this.cameraController.addShake(0.5);
      this.vfx.setShield(false);
      return true;
    }
    this.cameraController.addShake(0.9);
    this.score.onHit(this.player.state.distance);
    this.difficulty.grantRelief();
    return false;
  }

  private handleNearMiss(obstacle: ActiveObstacle): void {
    this.score.addNearMiss();
    this.cameraController.addShake(0.22);
    this.audio.play('SFX_Whoosh');
    bus.emit('player:nearMiss', { obstacle: obstacle.def.id, distance: 0 });
  }

  private handleDeath(cause: string): void {
    this.tutorial.finish();
    this.ui.setTutorial(null);
    this.difficulty.setCeiling(1);
    this.audio.play('SFX_GameOver');
    // stopAll() also stops the music, so the game-over track has to be set
    // after it or it never plays a note.
    this.audio.stopAll();
    this.audio.setMusic('gameover');
    this.cameraController.startGameOverShot();
    // Freeze scoring immediately. Leaving it running for the death animation
    // let the results panel show a higher score than the one banked as best.
    this.scoringFrozen = true;

    const stats = this.score.stats;
    const isBestScore = stats.score > this.save.state.bestScore;
    const isBestDistance = stats.distance > this.save.state.bestDistance;

    this.save.update((d) => {
      d.bestScore = Math.max(d.bestScore, stats.score);
      d.bestDistance = Math.max(d.bestDistance, stats.distance);
      d.coins += stats.coins;
      d.totalCoins += stats.coins;
      d.totalDistance += stats.distance;
      d.runs += 1;
      d.topSpeed = Math.max(d.topSpeed, stats.topSpeed);
      d.bestNoHitDistance = Math.max(d.bestNoHitDistance, stats.noHitDistance);
      d.totalNearMisses += stats.nearMisses;
      d.totalPowerUps += stats.powerUpsUsed;
    });
    this.missions.update(stats, this.save.state.runs);
    const completed = [...this.missions.completed];
    this.missions.endRun();
    const unlocked = this.achievements.evaluate();
    this.save.flush(true);

    bus.emit('run:end', { score: stats.score, distance: stats.distance, coins: stats.coins, cause });

    // Let the death animation play before the panel appears. This is driven
    // from the frame loop rather than a timer: a wall-clock timeout fires
    // while the game is paused, and pausing during the death animation used
    // to leave the run soft-locked in PLAYING with a dead player.
    this.pendingResults = { stats, isBestScore, isBestDistance, completed, unlocked };
    this.resultsCountdown = 1.5;
  }

  /** Shows the results panel once the death animation has played out. */
  private updateDeathSequence(dt: number): void {
    if (!this.pendingResults) return;
    this.resultsCountdown -= dt;
    if (this.resultsCountdown > 0) return;
    const results = this.pendingResults;
    this.pendingResults = null;
    if (this.state.is(GameState.TUTORIAL)) this.state.set(GameState.PLAYING);
    if (!this.state.is(GameState.PLAYING)) return;
    this.state.set(GameState.GAME_OVER);
    this.ui.showResults(results.stats, results.isBestScore, results.isBestDistance,
      results.completed, results.unlocked);
    this.ui.onState(GameState.GAME_OVER);
  }

  private togglePause(): void {
    if (this.state.is(GameState.PLAYING, GameState.TUTORIAL)) {
      this.pausedFromTutorial = this.state.is(GameState.TUTORIAL);
      this.state.set(GameState.PAUSED);
      this.ui.onState(GameState.PAUSED);
      this.audio.suspend();
    } else if (this.state.is(GameState.PAUSED)) {
      this.resume();
    }
  }

  private resume(): void {
    if (!this.state.is(GameState.PAUSED)) return;
    // Pausing part-way through the tutorial must not skip the rest of it.
    const target = this.pausedFromTutorial && this.tutorial.active ? GameState.TUTORIAL : GameState.PLAYING;
    this.pausedFromTutorial = false;
    this.state.set(target);
    this.ui.onState(target);
    void this.audio.resume();
    // Drop the accumulated time so the pause does not teleport the player.
    this.lastTime = performance.now();
  }

  private goHome(): void {
    this.state.set(GameState.MAIN_MENU);
    this.ui.onState(GameState.MAIN_MENU);
    this.animator.play('menuIdle', true);
    this.player.reset();
    this.track.reset(this.seed);
    // reset() empties the world; prime it again so the menu has a backdrop.
    this.track.update(0, 0, CFG.speed.base);
    this.vfx.reset();
    this.pendingResults = null;
    this.scoringFrozen = false;
    this.audio.setMusic('menu');
    void this.audio.resume();
  }

  private openPanel(panel: 'missions' | 'achievements' | 'settings'): void {
    const target =
      panel === 'missions' ? GameState.MISSIONS :
      panel === 'achievements' ? GameState.ACHIEVEMENTS : GameState.SETTINGS;
    if (this.state.set(target)) this.ui.onState(target);
  }

  private closePanel(): void {
    const back = this.state.previous;
    if (this.state.set(back)) this.ui.onState(back);
  }

  private applySettings(patch: Partial<Settings>): void {
    this.save.applySettings(patch);
    this.applyQuality();
    this.input.settings.invertVertical = this.save.settings.invertSwipe;
  }

  private applyQuality(): void {
    const s = this.save.settings;
    const profile = QUALITY_PROFILE[s.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, profile.pixelRatio);
    this.renderer.setPixelRatio(dpr);
    this.vfx.setPixelRatio(dpr);
    this.vfx.setQuality(s.reducedMotion, profile.particleScale);
    this.track.setDecorDensity(profile.decorDensity);

    const shadows = s.shadows && profile.shadowSize > 0;
    this.renderer.shadowMap.enabled = shadows;
    this.lighting.setShadows(shadows);
    if (shadows) this.lighting.setShadowQuality(profile.shadowSize);

    this.camera.far = CFG.camera.far * profile.viewScale;
    this.camera.updateProjectionMatrix();
    this.lighting.fitTo(this.camera.far);
    this.animator?.setFootIk(!s.reducedMotion || s.quality !== 'low');
  }

  // ------------------------------------------------------------- Frame loop

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  private frame(now: number): void {
    const frameStart = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // A tab switch or a long GC must never teleport the player through a wall.
    dt = Math.min(dt, CFG.performance.maxDelta);

    const scaled = dt * this.cameraController.timeScale;

    if (this.state.simulating) {
      this.updateSimulation(scaled);
    } else if (this.state.is(GameState.MAIN_MENU)) {
      this.updateMenu(dt);
    } else if (this.state.is(GameState.GAME_OVER)) {
      // Keep the death animation and camera move running.
      this.animator.update(scaled, {
        speed: 0, grounded: true, verticalVelocity: 0, airProgress: 0, slideProgress: 0,
        laneDir: 0, laneProgress: 1, laneQuick: false, cameraDistance: 8,
      });
      this.cameraController.update(dt, this.player.state);
      this.vfx.update(dt, 0, this.player.state.x, this.player.state.y, 0);
    }

    this.renderer.render(this.scene, this.camera);
    this.lastFrameMs = performance.now() - frameStart;
    this.trackPerformance(dt);
  }

  private updateSimulation(dt: number): void {
    const s = this.player.state;
    const previousDistance = s.distance;

    if (this.state.is(GameState.TUTORIAL)) this.updateTutorial(dt, s.distance);

    this.player.speedMultiplier = this.powerUps.speedMultiplier;
    this.player.update(dt, this.cameraDistanceToHero());

    const advanced = s.distance - previousDistance;
    this.difficulty.update(s.distance, dt);
    this.updateDeathSequence(dt);
    this.track.update(dt, s.distance, s.speed);

    // Collectibles.
    this.coins.magnetActive = this.powerUps.magnetActive;
    this.score.powerMultiplier = this.powerUps.scoreMultiplier;
    this.score.coinMultiplier = this.powerUps.coinMultiplier;
    this.coins.update(dt, s.distance, s.x, s.y, (x, y, z) => {
      this.score.addCoin();
      this.audio.play('SFX_Coin');
      bus.emit('coin:collect', { value: CFG.score.perCoin, combo: this.score.comboCount, position: [x, y, z] });
    });

    this.powerUps.update(dt, s.distance, s.x, s.y, (def) => {
      this.score.onPowerUp();
      this.audio.play('SFX_PowerUp');
      if (def.id === 'PWR_Boost_01') this.audio.play('SFX_Boost');
      if (def.id === 'PWR_Magnet_01') this.audio.play('SFX_Magnet');
    });
    this.vfx.setShield(this.powerUps.shielded);
    this.vfx.setMagnet(this.powerUps.magnetActive);

    // Scoring and progression. Both stop dead the moment the player does.
    if (!this.scoringFrozen) {
      this.score.update(dt, s.distance, s.speed);
      this.missions.update(this.score.stats, this.save.state.runs);
    }

    // Presentation.
    const speedT = Math.min(1, Math.max(0, (s.speed - CFG.speed.base) / (CFG.speed.max - CFG.speed.base)));
    this.zones.update(dt, s.distance);
    this.zones.follow(s.x, s.y);
    this.cameraController.update(dt, s);
    this.vfx.update(dt, advanced, s.x, s.y, speedT);
    if (s.sliding) this.vfx.play('VFX_SlideSparks', s.x, s.y, 0, 0.6);
    if (this.powerUps.speedMultiplier > 1) this.vfx.play('VFX_Boost', s.x, s.y, 0, 0.5);

    this.audio.setIntensity(speedT);
    this.audio.setTrainProximity(this.track.trainProximity(s.distance));

    this.ui.updateHud(this.score.score, s.distance, this.score.stats.coins, this.score.multiplier, this.score.comboProgress);
    this.ui.updatePowerUps(
      this.powerUps.effects.map((e) => ({
        id: e.def.id, label: e.def.label, remaining: e.remaining, duration: e.def.duration, color: e.def.color,
      })),
    );
    this.save.flush();
  }

  /** Steps the tutorial and releases the difficulty ceiling when it ends. */
  private updateTutorial(dt: number, distance: number): void {
    const step = this.tutorial.update(dt, distance);
    this.ui.setTutorial(step);
    if (this.tutorial.active) {
      this.difficulty.setCeiling(this.tutorial.difficultyCeiling);
      return;
    }
    this.difficulty.setCeiling(1);
    this.ui.setTutorial(null);
    this.state.set(GameState.PLAYING);
    this.ui.onState(GameState.PLAYING);
  }

  private updateMenu(dt: number): void {
    this.animator.update(dt, {
      speed: 0, grounded: true, verticalVelocity: 0, airProgress: 0, slideProgress: 0,
      laneDir: 0, laneProgress: 1, laneQuick: false, cameraDistance: 3.2,
    });
    this.cameraController.poseForMenu(dt, this.hero.identity.height);
    this.zones.update(dt, 0);
    this.zones.follow(0, 0);
    this.vfx.update(dt, 0, 0, 0, 0);
  }

  private cameraDistanceToHero(): number {
    return this.camera.position.distanceTo(this.hero.object.position);
  }

  private trackPerformance(dt: number): void {
    this.fpsTimer += dt;
    this.fpsSamples.push(1 / Math.max(0.0001, dt));
    if (this.fpsSamples.length > 90) this.fpsSamples.shift();

    // Automatic quality drop if the machine cannot hold the target.
    if (dt > 1 / 34) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (!this.autoQualityApplied && this.slowFrames > 120 && this.save.settings.quality === 'high') {
      this.autoQualityApplied = true;
      this.applySettings({ quality: 'medium' });
      bus.emit('ui:toast', { text: 'Quality reduced to keep the frame rate', tone: 'info' });
    }

    if (this.fpsTimer < 0.35) return;
    this.fpsTimer = 0;
    if (!this.save.settings.showFps) {
      this.ui.setFps('', false);
      return;
    }
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    const info = this.renderer.info;
    const world = this.track.stats;
    this.ui.setFps(
      [
        `${avg.toFixed(0)} fps   ${this.lastFrameMs.toFixed(1)} ms`,
        `draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k`,
        `mods ${world.modules} obs ${world.obstacles} decor ${world.decor}`,
        `coins ${this.coins.liveCount}  fx ${this.vfx.liveParticles}`,
        `diff ${this.difficulty.current.toFixed(2)} ${this.difficulty.label}`,
        `gen ok ${this.generator.stats.generated} rej ${this.generator.stats.rejected}`,
      ].join('\n'),
      true,
    );
  }

  // ---------------------------------------------------------------- Windowing

  private bindWindowEvents(): void {
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state.is(GameState.PLAYING, GameState.TUTORIAL)) this.togglePause();
    });
    window.addEventListener('blur', () => {
      if (this.state.is(GameState.PLAYING, GameState.TUTORIAL)) this.togglePause();
    });
    window.addEventListener('beforeunload', () => this.save.flush(true));
  }

  resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.cameraController.resize(width, height);
  }

  dispose(): void {
    this.stop();
    this.input.dispose();
    this.audio.dispose();
    this.vfx.dispose();
    this.coins.dispose();
    this.hero?.dispose();
    this.renderer.dispose();
  }
}
