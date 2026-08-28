/**
 * Fullscreen, across the browsers that spell it differently.
 *
 * Safari still only has the `webkit` prefixed calls, and it puts `exit` on the
 * document while `request` lives on the element. iOS Safari has neither for
 * ordinary elements — it only does this for `<video>` — so `available` is
 * false there and the control hides itself rather than offering something that
 * cannot work.
 *
 * A page inside an iframe can only do this if the frame was given permission
 * (`allow="fullscreen"`). When it was not, `requestFullscreen` rejects, and
 * the caller is told so it can say something useful instead of silently doing
 * nothing.
 */

interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

const doc = document as WebkitDocument;

/** True when this browser can put an ordinary element fullscreen at all. */
export function available(): boolean {
  const probe = document.documentElement as WebkitElement;
  return !!(probe.requestFullscreen || probe.webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/**
 * Toggles, and resolves with what happened. `false` means the browser refused
 * — most often because the page is framed without the permission.
 */
export async function toggle(target: HTMLElement = document.documentElement): Promise<boolean> {
  try {
    if (isFullscreen()) {
      await (doc.exitFullscreen?.() ?? (doc.webkitExitFullscreen?.() as Promise<void> | undefined));
      return true;
    }
    const el = target as WebkitElement;
    const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
    if (!request) return false;
    await request();
    return isFullscreen();
  } catch {
    return false;
  }
}

/** Calls back whenever the state changes, and returns an unsubscribe. */
export function onChange(fn: () => void): () => void {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
  return () => {
    document.removeEventListener('fullscreenchange', fn);
    document.removeEventListener('webkitfullscreenchange', fn);
  };
}
