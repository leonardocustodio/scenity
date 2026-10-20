// SPDX-License-Identifier: Apache-2.0
/**
 * One terminal of the Claude panel: an xterm.js screen on a PTY of the host.
 *
 * The keys of the screen go to the PTY as `terminal.input`. A resize of the screen sends `terminal.resize`. The
 * `terminal.output` events of the host go to the screen. The ID of the PTY stays in the session storage. Thus a reload
 * of the page (or a hidden and shown column) opens the same PTY again and writes its scrollback first. A new
 * connection to the host also opens the PTY again. A host that does not know the ID starts a new PTY.
 *
 * The ⌘ chords stay with the workbench (⌘\ hides the column, ⌘C and ⌘V copy and paste). The screen ignores them.
 * The module takes a factory of the screen, so a test gives a fake screen.
 */
import type { TerminalExit, TerminalKind, TerminalOpened } from "@scenity/workbench-host/protocol";
import { ref, shallowRef, type Ref } from "vue";
import type { HostClient } from "../host/hostClient";
import { storageItem } from "@scenity/labs-platform/storageKeys";

/** The parts of an xterm.js `Terminal` that the panel uses. */
export interface XtermLike {
  readonly cols: number;
  readonly rows: number;
  open(parent: HTMLElement): void;
  /** Write output; the callback runs after the screen parsed it. */
  write(data: string, done?: () => void): void;
  reset(): void;
  focus(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void };
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  dispose(): void;
}

/** A screen and the function that fits it to its element (the fit addon). */
export interface XtermKit {
  readonly term: XtermLike;
  fit(): void;
}

/** The parts of the host client that a terminal uses. */
export type TerminalClient = Pick<HostClient, "request" | "on" | "onHello">;

/** The storage of the terminal IDs (the session storage of the page). */
export type IdStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The state of a terminal: no PTY yet, the open request, a running program, an ended program, or a failure. */
export type TerminalPhase = "idle" | "starting" | "running" | "exited" | "failed";

export interface UseTerminalOptions {
  readonly client: TerminalClient;
  readonly kind: TerminalKind;
  /** The key of the PTY ID in the storage (one per checkout and kind). */
  readonly storageKey: string;
  /** The screen factory: a screen, or the promise of one (the real xterm.js loads in a chunk of its own). */
  readonly makeXterm: () => XtermKit | Promise<XtermKit>;
  /** The storage of the ID. The default is the session storage; null keeps no ID. */
  readonly storage?: IdStorage | null;
}

export interface TerminalApi {
  readonly phase: Readonly<Ref<TerminalPhase>>;
  readonly exit: Readonly<Ref<TerminalExit | null>>;
  readonly error: Readonly<Ref<string | null>>;
  /** The ID of the PTY, or null. */
  readonly id: Readonly<Ref<string | null>>;
  /** Make the screen in the element and open the PTY (the stored one, or a new one). */
  attach(element: HTMLElement): Promise<void>;
  /** Fit the screen to its element; a new size goes to the PTY. */
  fit(): void;
  focus(): void;
  /** End the PTY and start a new one with a clean screen ("Restart", "New shell"). */
  restart(): Promise<void>;
  /** End the PTY and start the CLI with `--resume <session>` ("Resume" of the Claude tab). */
  resume(session: string): Promise<void>;
  /** Remove the screen and the listeners. The PTY continues in the host. */
  dispose(): void;
}

function sessionStore(): IdStorage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for a key that the screen must ignore: a ⌘ chord of the workbench or of the browser. */
export function isWorkbenchKey(event: KeyboardEvent): boolean {
  return event.metaKey;
}

/** The PTY ID in the storage of the page. A blocked storage reads nothing and writes nothing. */
function idStore(storage: IdStorage | null, key: string): { read(): string | null; write(value: string | null): void } {
  return {
    read: () => {
      try {
        return storage === null ? null : storageItem(storage, key);
      } catch {
        return null;
      }
    },
    write: (value) => {
      try {
        if (value === null) storage?.removeItem(key);
        else storage?.setItem(key, value);
      } catch {
        // A blocked storage forgets the PTY at the next load; the host then starts a new one.
      }
    },
  };
}

/** One terminal: the screen, the PTY ID and the state (the parts of `useTerminal`, split for the file size rule). */
class TerminalSession {
  readonly phase = ref<TerminalPhase>("idle");
  readonly exit = shallowRef<TerminalExit | null>(null);
  readonly error = ref<string | null>(null);
  readonly id = ref<string | null>(null);
  kit: XtermKit | null = null;
  /** True while the screen parses the scrollback of a PTY that the page opens again. */
  #muted = false;
  #attaching = false;
  #disposed = false;
  readonly #stops: (() => void)[] = [];
  readonly #options: UseTerminalOptions;
  readonly #store: ReturnType<typeof idStore>;

  constructor(options: UseTerminalOptions) {
    this.#options = options;
    this.#store = idStore(options.storage === undefined ? sessionStore() : options.storage, options.storageKey);
  }

  #opened(result: TerminalOpened): void {
    const term = this.kit?.term;
    if (result.attached && term !== undefined) {
      term.reset();
      // The scrollback holds the old queries of the program (cursor place, colors, device). The screen answers
      // them as keys; the panel does not send these answers to the program.
      this.#muted = true;
      term.write(result.replay, () => (this.#muted = false));
    }
    this.id.value = result.terminal;
    this.#store.write(result.terminal);
    this.exit.value = result.exit;
    this.phase.value = result.exit === null ? "running" : "exited";
  }

  /** Open the stored PTY again, or a new one (a new `claude` PTY can resume a session). */
  async open(resume?: string): Promise<void> {
    if (this.kit === null) return;
    this.phase.value = "starting";
    this.error.value = null;
    const known = this.id.value ?? this.#store.read();
    const { cols, rows } = this.kit.term;
    const { client, kind } = this.#options;
    try {
      const params = {
        ...{ kind, cols, rows },
        ...(known === null ? {} : { terminal: known }),
        ...(resume === undefined ? {} : { resume }),
      };
      this.#opened(await client.request("terminal.open", params));
    } catch (reason) {
      this.error.value = errorText(reason);
      this.phase.value = "failed";
    }
  }

  #send(data: string): void {
    const current = this.id.value;
    if (current === null || this.phase.value !== "running" || this.#muted) return;
    this.#options.client.request("terminal.input", { terminal: current, data }).catch((reason: unknown) => {
      this.error.value = errorText(reason);
    });
  }

  #listen(term: XtermLike): void {
    const { client } = this.#options;
    const input = term.onData((data) => this.#send(data));
    const resize = term.onResize(({ cols, rows }) => {
      const current = this.id.value;
      if (current === null || this.phase.value !== "running") return;
      client.request("terminal.resize", { terminal: current, cols, rows }).catch(() => undefined);
    });
    this.#stops.push(
      () => input.dispose(),
      () => resize.dispose(),
      client.on("terminal.output", ({ terminal, data }) => {
        if (terminal === this.id.value) term.write(data);
      }),
      client.on("terminal.exit", ({ terminal, code, signal }) => {
        if (terminal !== this.id.value) return;
        this.exit.value = { code, signal };
        this.phase.value = "exited";
      }),
      client.onHello(() => void this.open()),
    );
  }

  async attach(element: HTMLElement): Promise<void> {
    if (this.kit !== null || this.#attaching) return;
    this.#attaching = true;
    let kit: XtermKit;
    try {
      kit = await this.#options.makeXterm();
    } finally {
      this.#attaching = false;
    }
    if (this.#disposed) {
      kit.term.dispose();
      return;
    }
    this.kit = kit;
    kit.term.attachCustomKeyEventHandler((event) => !isWorkbenchKey(event));
    kit.term.open(element);
    kit.fit();
    this.#listen(kit.term);
    await this.open();
  }

  async restart(resume?: string): Promise<void> {
    const old = this.id.value ?? this.#store.read();
    this.id.value = null;
    this.#store.write(null);
    this.exit.value = null;
    if (old !== null) await this.#options.client.request("terminal.close", { terminal: old }).catch(() => undefined);
    this.kit?.term.reset();
    await this.open(resume);
  }

  dispose(): void {
    this.#disposed = true;
    for (const stop of this.#stops.splice(0)) stop();
    this.kit?.term.dispose();
    this.kit = null;
  }
}

export function useTerminal(options: UseTerminalOptions): TerminalApi {
  const session = new TerminalSession(options);
  return {
    phase: session.phase,
    exit: session.exit,
    error: session.error,
    id: session.id,
    attach: (element) => session.attach(element),
    fit: () => session.kit?.fit(),
    focus: () => session.kit?.term.focus(),
    restart: () => session.restart(),
    resume: (id) => session.restart(id),
    dispose: () => session.dispose(),
  };
}
