// SPDX-License-Identifier: Apache-2.0
/**
 * The commands of the labs app shell for the workbench page. The page calls them through the Tauri internals of its
 * window (no `@tauri-apps/api` package), as `host/endpoint.ts` and `host/menuEvents.ts` do. In a browser, the
 * internals do not exist. Then every function here gives null or does nothing, and the callers keep the browser path.
 *
 * - `shellFeature(name)`: the features of the shell (`__SCENITY_SHELL__.features`: `drawsBehind`, `snapshot`,
 *   `webp`, `mp4`), which the shell sets before the page script runs.
 * - `invokeRaw`: a command whose argument is raw bytes (an `ArrayBuffer` body with headers, not JSON).
 * - `readFramed`: a raw answer of the shell, a JSON header in front of the bytes (`raw.rs` `framed`).
 */

/** The Tauri internals that the page uses. */
export interface ShellInternals {
  invoke(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown>;
  transformCallback?(callback: (message: unknown) => void, once?: boolean): number;
  unregisterCallback?(id: number): void;
}

/** The window parts of the shell calls (a test gives a fake). */
export interface ShellWindow {
  readonly __TAURI_INTERNALS__?: Partial<ShellInternals>;
  readonly __SCENITY_SHELL__?: { readonly features?: readonly string[] };
  /** The old name of `__SCENITY_SHELL__`. An older shell sets this name. */
  readonly __CODEBLUE_LABS_SHELL__?: { readonly features?: readonly string[] };
}

function win(): ShellWindow {
  return globalThis as ShellWindow;
}

/** The internals of the labs app, or null in a browser. */
export function shellInternals(from: ShellWindow = win()): ShellInternals | null {
  const internals = from.__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function" ? (internals as ShellInternals) : null;
}

/** True when the shell of the labs app has the feature (and the page has the internals to use it). */
export function shellFeature(name: string, from: ShellWindow = win()): boolean {
  const features = (from.__SCENITY_SHELL__ ?? from.__CODEBLUE_LABS_SHELL__)?.features;
  return shellInternals(from) !== null && Array.isArray(features) && features.includes(name);
}

/** Call a command of the shell; null in a browser. */
export async function invokeShell(command: string, args?: Record<string, unknown>, from = win()): Promise<unknown> {
  const internals = shellInternals(from);
  if (internals === null) return null;
  return internals.invoke(command, args);
}

/** Call a command of the shell with raw bytes as its argument (headers carry the facts); null in a browser. */
export async function invokeRaw(
  command: string,
  bytes: ArrayBuffer | Uint8Array,
  headers: Record<string, string>,
  from = win(),
): Promise<unknown> {
  const internals = shellInternals(from);
  if (internals === null) return null;
  return internals.invoke(command, bytes, { headers });
}

/** A raw answer of the shell: the JSON header and the bytes (a view, no copy). */
export interface Framed {
  readonly header: Record<string, unknown>;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** Read a raw answer: a u32 (little-endian) length, the JSON header, then the bytes. Throws for other data. */
export function readFramed(value: unknown): Framed {
  if (!(value instanceof ArrayBuffer)) throw new Error("The shell gave no bytes.");
  if (value.byteLength < 4) throw new Error("The answer of the shell is too short.");
  const length = new DataView(value).getUint32(0, true);
  if (4 + length > value.byteLength) throw new Error("The header of the answer of the shell is cut.");
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(value, 4, length))) as unknown;
  if (typeof header !== "object" || header === null) throw new Error("The header of the shell is not an object.");
  return { header: header as Record<string, unknown>, bytes: new Uint8Array(value, 4 + length) };
}

/** A copy of the bytes in a buffer of their own (a transfer or a Blob of exactly these bytes). */
export function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/**
 * The target of a listen. `Any` gets the event of every window. Tauri sends the drag and drop events to the label of
 * one window, and a listener with the target `Any` gets them from all windows. The target `WebviewWindow` with the
 * label of this window gets only the events of this window.
 */
export type ListenTarget = { readonly kind: "Any" } | { readonly kind: "WebviewWindow"; readonly label: string };

/**
 * Listen to an event of the shell for this window (`plugin:event|listen`, as `menuEvents.ts`). Give the stop
 * function, or null in a browser or when the listen fails.
 */
export async function listenShell(
  event: string,
  onPayload: (payload: unknown) => void,
  from = win(),
  target: ListenTarget = { kind: "Any" },
): Promise<(() => void) | null> {
  const internals = shellInternals(from);
  if (internals === null || typeof internals.transformCallback !== "function") return null;
  const handler = internals.transformCallback((message) => {
    if (typeof message === "object" && message !== null) onPayload((message as { payload?: unknown }).payload);
  });
  let id: unknown;
  try {
    id = await internals.invoke("plugin:event|listen", { event, target, handler });
  } catch {
    internals.unregisterCallback?.(handler);
    return null;
  }
  if (typeof id !== "number") return null;
  const eventId = id;
  return () => {
    internals.invoke("plugin:event|unlisten", { event, eventId }).catch(() => undefined);
    internals.unregisterCallback?.(handler);
  };
}
