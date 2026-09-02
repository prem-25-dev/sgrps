import { bus } from './EventBus';
import { SaveManager } from '../save/SaveManager';

/**
 * First-run tutorial.
 *
 * It teaches by asking, not by blocking: the run is real from the first
 * metre, and each step waits for the player to perform the action for the
 * first time. Steps that go unanswered time out, so a player who already
 * knows the genre is never held up.
 *
 * The generator is clamped to zero difficulty while this is running, so the
 * world stays a gentle place to learn in.
 */

export interface TutorialStep {
  id: string;
  /** Shown to the player. Keep it to one short line. */
  prompt: string;
  /** Secondary line naming the controls. */
  keys: string;
  /** Distance in metres before this step may appear. */
  fromDistance: number;
  /** Seconds to wait for the action before moving on regardless. */
  timeout: number;
  /** Event that satisfies this step. */
  satisfiedBy: 'laneChange' | 'jump' | 'slide' | 'coin' | 'none';
}

const STEPS: TutorialStep[] = [
  {
    id: 'TUT_Run',
    prompt: 'You run automatically. Just stay alive.',
    keys: '',
    fromDistance: 0,
    timeout: 4,
    satisfiedBy: 'none',
  },
  {
    id: 'TUT_Lane',
    prompt: 'Switch lanes',
    keys: '← →  or swipe sideways',
    fromDistance: 45,
    timeout: 12,
    satisfiedBy: 'laneChange',
  },
  {
    id: 'TUT_Jump',
    prompt: 'Jump over what is in your way',
    keys: '↑ / Space  or swipe up',
    fromDistance: 130,
    timeout: 14,
    satisfiedBy: 'jump',
  },
  {
    id: 'TUT_Slide',
    prompt: 'Slide under what is above you',
    keys: '↓ / Shift  or swipe down',
    fromDistance: 230,
    timeout: 14,
    satisfiedBy: 'slide',
  },
  {
    id: 'TUT_Coins',
    prompt: 'Coins build a combo. The multiplier is where the score is.',
    keys: '',
    fromDistance: 330,
    timeout: 8,
    satisfiedBy: 'coin',
  },
  {
    id: 'TUT_Done',
    prompt: 'That is everything. Go as far as you can.',
    keys: '',
    fromDistance: 430,
    timeout: 5,
    satisfiedBy: 'none',
  },
];

export class Tutorial {
  private index = -1;
  /** Seconds spent on the current step. */
  private elapsed = 0;
  /** Seconds left holding a completed prompt on screen before clearing it. */
  private hold = 0;
  /** Set once the current step has been performed or timed out. */
  private stepDone = false;
  private satisfied = false;
  private finished = false;
  private unsubscribe: Array<() => void> = [];

  constructor(private readonly save: SaveManager) {}

  /** True when the player has never completed a run. */
  get shouldRun(): boolean {
    return this.save.state.runs === 0;
  }

  get active(): boolean {
    return !this.finished;
  }

  get currentStep(): TutorialStep | null {
    return this.index >= 0 && this.index < STEPS.length ? STEPS[this.index] : null;
  }

  /** Difficulty ceiling while teaching, so the world stays readable. */
  get difficultyCeiling(): number {
    return this.finished ? 1 : 0.1;
  }

  start(): void {
    this.index = -1;
    this.elapsed = 0;
    this.hold = 0;
    this.stepDone = false;
    this.satisfied = false;
    this.finished = false;
    this.detach();

    const satisfy = (kind: TutorialStep['satisfiedBy']) => () => {
      const step = this.currentStep;
      if (step && step.satisfiedBy === kind) this.satisfied = true;
    };
    this.unsubscribe = [
      bus.on('player:laneChange', satisfy('laneChange')),
      bus.on('player:jump', satisfy('jump')),
      bus.on('player:slide', satisfy('slide')),
      bus.on('coin:collect', satisfy('coin')),
    ];
  }

  /**
   * Returns the step to display this frame, or null.
   *
   * A step ends when the player performs it or its timeout expires. The
   * prompt then holds briefly so the player sees they got it right, and
   * clears until the next step's distance gate is reached.
   */
  update(dt: number, distance: number): TutorialStep | null {
    if (this.finished) return null;

    const step = this.currentStep;

    // Currently showing a step: run its clock until it is done. The done flag
    // matters — without it the step re-enters this branch after its hold
    // expires and the tutorial never advances.
    if (step && !this.stepDone) {
      this.elapsed += dt;
      if (!this.satisfied && this.elapsed < step.timeout) return step;
      // Completed. Hold it on screen for a beat so the player registers it.
      this.stepDone = true;
      this.hold = this.satisfied ? 1.1 : 0.35;
      return step;
    }

    // Holding a completed prompt.
    if (this.hold > 0) {
      this.hold -= dt;
      return this.hold > 0 ? step : null;
    }

    // Between steps: advance once the next one's distance gate is passed.
    const next = this.index + 1;
    if (next >= STEPS.length) {
      this.finish();
      return null;
    }
    if (distance < STEPS[next].fromDistance) return null;

    this.index = next;
    this.elapsed = 0;
    this.satisfied = false;
    this.stepDone = false;
    return this.currentStep;
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.index = STEPS.length;
    this.detach();
  }

  private detach(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
  }

  dispose(): void {
    this.detach();
  }
}
