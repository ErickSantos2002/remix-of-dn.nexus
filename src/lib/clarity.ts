// Microsoft Clarity helpers.
// Loads the official tag script dynamically and exposes thin wrappers over the
// client API: window.clarity("event"|"set"|"identify", ...).
//
// Reference: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-api

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
    __nexus_clarity_projects_initialized?: Record<string, boolean>;
  }
}

const STATE_KEY = "__nexus_clarity_projects_initialized";

function getState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  const w = window as unknown as Record<string, Record<string, boolean> | undefined>;
  if (!w[STATE_KEY]) w[STATE_KEY] = {};
  return w[STATE_KEY] as Record<string, boolean>;
}

/**
 * Inject the Clarity tag script for the given project ID (no-op if already injected).
 * Safe to call multiple times.
 */
export function loadClarity(projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const state = getState();
  if (state[projectId]) return true;
  state[projectId] = true;

  try {
    /* eslint-disable */
    (function (c: any, l: Document, a: string, r: string, i: string) {
      c[a] = c[a] || function () {
        (c[a].q = c[a].q || []).push(arguments);
      };
      const t = l.createElement(r) as HTMLScriptElement;
      t.async = true;
      t.src = "https://www.clarity.ms/tag/" + i;
      const y = l.getElementsByTagName(r)[0];
      y?.parentNode?.insertBefore(t, y);
    })(window, document, "clarity", "script", projectId);
    /* eslint-enable */
    return true;
  } catch (err) {
    console.error("[Clarity] Failed to load script:", err);
    return false;
  }
}

export function clarityEvent(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.clarity?.("event", name);
  } catch (err) {
    console.error("[Clarity] event error:", err);
  }
}

export function claritySet(key: string, value: string | string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.clarity?.("set", key, value);
  } catch (err) {
    console.error("[Clarity] set error:", err);
  }
}

export function clarityIdentify(customId: string): void {
  if (typeof window === "undefined" || !customId) return;
  try {
    window.clarity?.("identify", customId);
  } catch (err) {
    console.error("[Clarity] identify error:", err);
  }
}

/**
 * Apply a bundle of tags at once (skips empty values).
 */
export function claritySetTags(tags: Record<string, string | string[] | null | undefined>): void {
  for (const [k, v] of Object.entries(tags)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && !v) continue;
    claritySet(k, v);
  }
}
