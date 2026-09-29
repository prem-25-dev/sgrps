import {
  SaveManager, readSettings, readBindings, DEFAULT_SETTINGS, DEFAULT_BINDINGS,
  BINDABLE_ACTIONS, KeyBindings, rebind,
} from '../src/save/SaveManager';
import { InputManager } from '../src/player/InputManager';

/**
 * Rebindable controls, and the settings validation they rest on.
 *
 * Two things are checked here, because the second exists for the first.
 *
 * Key bindings are player data now rather than a switch statement, which means
 * a stored value decides whether the game can be played at all. An action left
 * with no keys is an action that can never be performed — a player who cannot
 * jump cannot survive the first barrier, with nothing on screen to explain why.
 *
 * And settings were, until this feature, the one part of the save that was not
 * parsed defensively: the whole object was spread in as-is. A `quality` value
 * outside the three known levels reached `QUALITY_PROFILE[quality]` as
 * `undefined` on the first boot frame and threw, and since the same bad value
 * was read again on every reload, the game stayed broken until the player
 * cleared their site data. Bindings are a far richer shape than a string enum,
 * so that hole had to close before they could be stored at all.
 */

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

/** Minimal localStorage, so SaveManager runs its real code path. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  poke(k: string, v: string): void { this.map.set(k, v); }
}

const STORE_KEY = 'neon-run.save.v3';
let store = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;

function freshStore(): MemoryStorage {
  store = new MemoryStorage();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;
  return store;
}

// ---------------------------------------------------------------------------
console.log('Settings validation:');
{
  // The exact payload that used to brick the game: a quality level this build
  // has never heard of, as a rollback or a hand-edited save would leave behind.
  const s = readSettings({ quality: 'ultra' });
  check('an unknown quality level falls back to a real one',
    (['low', 'medium', 'high'] as string[]).includes(s.quality), s.quality);

  check('a non-numeric volume falls back to the default',
    readSettings({ musicVolume: 'loud' }).musicVolume === DEFAULT_SETTINGS.musicVolume);
  check('a NaN volume falls back to the default',
    readSettings({ sfxVolume: NaN }).sfxVolume === DEFAULT_SETTINGS.sfxVolume);
  check('an out-of-range volume is clamped rather than dropped',
    readSettings({ musicVolume: 4 }).musicVolume === 1
    && readSettings({ musicVolume: -2 }).musicVolume === 0);
  check('a non-boolean toggle falls back to the default',
    readSettings({ shadows: 'yes' }).shadows === DEFAULT_SETTINGS.shadows);
  check('a valid value survives validation',
    readSettings({ quality: 'low', showFps: true, sfxVolume: 0.25 }).quality === 'low');

  // Nothing about a settings payload may throw: it is read during boot.
  let threw = '';
  for (const junk of [null, undefined, 42, 'settings', [], { keyBindings: 7 }]) {
    try { readSettings(junk); } catch (err) { threw = `${JSON.stringify(junk)}: ${(err as Error).message}`; }
  }
  check('no payload shape can make validation throw', threw === '', threw);
}

// ---------------------------------------------------------------------------
console.log('\nBinding validation:');
{
  check('garbage becomes the default bindings',
    readBindings('nonsense').jump.join() === DEFAULT_BINDINGS.jump.join());

  // The failure that matters: an action nobody can perform.
  const stranded = readBindings({ ...DEFAULT_BINDINGS, jump: [] });
  check('an action with no keys is given its default back',
    stranded.jump.length > 0, JSON.stringify(stranded.jump));
  check('an action whose keys are all junk is given its default back',
    readBindings({ jump: [1, null, ''] }).jump.length > 0);
  check('every action always ends up playable',
    BINDABLE_ACTIONS.every((a) => readBindings({}).length !== 0 && readBindings({})[a].length > 0));

  check('a duplicate key within one action is collapsed',
    readBindings({ left: ['KeyZ', 'KeyZ'] }).left.length === 1);
  check('a custom binding is kept',
    readBindings({ left: ['KeyZ'] }).left.join() === 'KeyZ');

  // The defaults must not be reachable for mutation through a save.
  const save = new SaveManager();
  save.settings.keyBindings.jump.push('KeyQ');
  check('mutating a save cannot corrupt the shared defaults',
    !DEFAULT_BINDINGS.jump.includes('KeyQ'), DEFAULT_BINDINGS.jump.join());
}

// ---------------------------------------------------------------------------
console.log('\nRebinding:');
{
  const b = DEFAULT_BINDINGS;

  const moved = rebind(b, 'left', 0, 'KeyZ');
  check('a free key lands in the slot it was chosen for',
    moved.ok && moved.bindings.left[0] === 'KeyZ',
    moved.ok ? moved.bindings.left.join() : moved.reason);
  check('the key it replaced is released',
    moved.ok && !moved.bindings.left.includes('ArrowLeft'));
  check('the other slots of the same action are untouched',
    moved.ok && moved.bindings.left.includes('KeyA'));
  check('other actions are untouched',
    moved.ok && moved.bindings.jump.join() === b.jump.join());
  check('the original bindings are not mutated',
    b.left[0] === 'ArrowLeft', b.left.join());

  // Taking a key from an action that has others is the point of a rebind.
  const stolen = rebind(b, 'slide', 0, 'KeyW');
  check('a key held by another action is taken from it',
    stolen.ok && stolen.bindings.slide.includes('KeyW')
    && !stolen.bindings.jump.includes('KeyW'),
    stolen.ok ? stolen.bindings.jump.join() : stolen.reason);
  check('the action it was taken from is still playable',
    stolen.ok && stolen.bindings.jump.length > 0);

  // But not when it is the last key that action has.
  const single: KeyBindings = { ...DEFAULT_BINDINGS, pause: ['KeyP'] };
  const refused = rebind(single, 'jump', 0, 'KeyP');
  check('taking an action\'s last key is refused', !refused.ok);
  check('the refusal names the action that would have been stranded',
    !refused.ok && refused.reason === 'last-key' && refused.conflict === 'pause',
    JSON.stringify(refused));

  const reserved = rebind(b, 'jump', 0, 'Enter');
  check('Enter is refused outright',
    !reserved.ok && reserved.reason === 'reserved', JSON.stringify(reserved));

  // Binding a key an action already holds must not leave a duplicate chip.
  const dup = rebind(b, 'jump', 0, 'Space');
  check('rebinding onto a key the action already has collapses the duplicate',
    dup.ok && dup.bindings.jump.filter((k) => k === 'Space').length === 1,
    dup.ok ? dup.bindings.jump.join() : dup.reason);
  check('collapsing a duplicate never empties the action',
    dup.ok && dup.bindings.jump.length > 0);

  // A slot index from a stale render must not create a hole in the array.
  const oob = rebind(b, 'left', 9, 'KeyZ');
  check('an out-of-range slot appends instead of tearing the list',
    oob.ok && oob.bindings.left.includes('KeyZ')
    && oob.bindings.left.every((k) => typeof k === 'string'),
    oob.ok ? JSON.stringify(oob.bindings.left) : oob.reason);
}

// ---------------------------------------------------------------------------
console.log('\nPersistence:');
{
  freshStore();
  const save = new SaveManager();
  const custom: KeyBindings = { ...DEFAULT_BINDINGS, jump: ['KeyZ'], left: ['KeyN'] };
  save.applySettings({ keyBindings: custom });

  const reloaded = new SaveManager();
  check('a rebound key survives a reload',
    reloaded.settings.keyBindings.jump.join() === 'KeyZ',
    reloaded.settings.keyBindings.jump.join());
  check('untouched actions keep their defaults',
    reloaded.settings.keyBindings.slide.join() === DEFAULT_BINDINGS.slide.join());

  // applySettings is the live path, and it is validated like the stored one.
  save.applySettings({ quality: 'ultra' as never });
  check('a live setting change is validated too',
    save.settings.quality !== ('ultra' as string), save.settings.quality);
  save.applySettings({ keyBindings: { ...DEFAULT_BINDINGS, jump: [] } });
  check('a live change cannot strand an action either',
    save.settings.keyBindings.jump.length > 0);

  // The original defect, exercised where it actually happened: not through
  // readSettings directly, but through a stored payload on the boot path.
  freshStore();
  store.poke(STORE_KEY, JSON.stringify({
    version: 3,
    settings: { quality: 'ultra', musicVolume: 'loud', keyBindings: { jump: [] } },
  }));
  const rescued = new SaveManager();
  check('a stored payload is validated on load, not merged blind',
    (['low', 'medium', 'high'] as string[]).includes(rescued.settings.quality),
    rescued.settings.quality);
  check('a stored volume that is not a number is repaired on load',
    typeof rescued.settings.musicVolume === 'number'
    && Number.isFinite(rescued.settings.musicVolume),
    String(rescued.settings.musicVolume));
  check('stored bindings that strand an action are repaired on load',
    rescued.settings.keyBindings.jump.length > 0);

  // A save written before this feature existed has no bindings at all.
  freshStore();
  store.poke(STORE_KEY, JSON.stringify({ version: 3, bestScore: 900, settings: { quality: 'low' } }));
  const legacy = new SaveManager();
  check('a save from before rebinding still loads', legacy.state.bestScore === 900);
  check('a save from before rebinding gets the default bindings',
    legacy.settings.keyBindings.jump.join() === DEFAULT_BINDINGS.jump.join());
}

// ---------------------------------------------------------------------------
console.log('\nInput mapping:');
{
  // A stand-in for the window: nothing here calls attach(), and the mapping is
  // pure lookup.
  const target = { addEventListener() {}, removeEventListener() {} } as unknown as Window;
  const input = new InputManager(target);

  check('the defaults map the arrow keys', input.actionFor('ArrowLeft') === 'left');
  check('the defaults map the WASD cluster', input.actionFor('KeyW') === 'jump');
  check('an unbound key does nothing', input.actionFor('KeyJ') === null);

  input.setBindings({ ...DEFAULT_BINDINGS, jump: ['KeyJ'], left: ['KeyH'] });
  check('a rebound key performs its new action', input.actionFor('KeyJ') === 'jump');
  check('the key it replaced stops working', input.actionFor('KeyW') === null);
  check('actions that were not rebound are untouched',
    input.actionFor('ArrowDown') === 'slide' && input.actionFor('Escape') === 'pause');

  // Confirm is how a player leaves the menu that holds the rebinding controls.
  input.setBindings({ ...DEFAULT_BINDINGS, jump: ['Enter'] });
  check('Enter cannot be taken away from confirm', input.actionFor('Enter') === 'confirm');

  input.setBindings(DEFAULT_BINDINGS);
  check('resetting restores the defaults', input.actionFor('KeyW') === 'jump');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
