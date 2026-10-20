// SPDX-License-Identifier: Apache-2.0
/**
 * The keys of the scene page: one key listener for the page, the key map of `@scenity/editor-core` and two command
 * sources. Each key of the page is a command:
 *
 * - the page commands (this registry): the actions of the page with no edit. Examples are `file.save`,
 *   `history.undo`, `gizmo.move`, `view.frame`, `camera.open1`, `inspect.toggle` and the clock of the sequencer. Each
 *   part of the page (a lazy chunk, a panel) registers its commands when it starts and removes them when it stops.
 * - the scene commands of the edit mode (hierarchy/sceneCommands.ts: `entity.duplicate`, `entity.delete`, …). They
 *   run as runs of the owner through the runner.
 *
 * A key press gives a chord (`chordOfEvent`) and the contexts of the element with the focus. The contexts are the
 * `data-key-context` values from the element up to the page, then `scene` (outside the bottom dock) and `global`. The
 * first command of the key map in that order that can run gets the key. A command that cannot run (its condition
 * gives a reason) lets the key continue. Thus ⌘C with no selection keeps the copy of the browser. A key in a text
 * field reaches only the commands that accept it there (`inText`). A key on a control with no text (a select) also
 * reaches the commands with `inControls`.
 *
 * The keys of the page are also the one command registry of the editor window. `list()` gives each command of the
 * window (the page commands, the scene commands and the sequence commands). Each item has its metadata, its current
 * keys and the state "can run". `execute()` runs one command with its arguments for a person, a script or an agent.
 *
 * Some keys are not in the key map. The fly keys and the arrow keys of the editor camera move the camera while they
 * are down (viewport/viewportInput.ts). The typed values, Enter and Escape of a gizmo drag are also not in it, and
 * neither is Escape that stops a drag or closes a menu. These keys are modal input of one gesture, not commands.
 */
import { t } from "../../texts";
import {
  chordOfEvent,
  CommandError,
  createCommandRegistry,
  createKeyMap,
  GLOBAL_CONTEXT,
  type ArgSpec,
  type Args,
  type Command,
  type CommandListing,
  type CommandOptions,
  type KeyCommand,
  type ProposalMode,
  type KeyMap,
  type RuleState,
} from "@scenity/editor-core";
import { typingInto } from "../../core/labUi";
import { pageSettings } from "./pageSettings";

/** The context of the keys of the viewport and the side panels (each place outside the bottom dock). */
export const SCENE_CONTEXT = "scene";

/** A command of the page: its keys, its condition and its action. */
export interface PageKeyCommandSpec {
  readonly id: string;
  readonly title: string;
  readonly keys?: readonly string[];
  /** The context of the keys (default `global`). */
  readonly keyContext?: string;
  /** True: a held key repeats the command (the undo, the steps of the clock). */
  readonly repeat?: boolean;
  /** True: the key also acts in a text field (⌘S). */
  readonly inText?: boolean;
  /** True: the key also acts on a control with no text (a select, a check box): ⌘Z, ⇧⌘Z. */
  readonly inControls?: boolean;
  /** The metadata of the command (`Command` of `@scenity/editor-core`). */
  readonly description?: string;
  readonly icon?: string;
  readonly category?: string;
  readonly menu?: string;
  /** The arguments (a menu item or the status bar gives them, and a key gives none). */
  readonly args?: Readonly<Record<string, ArgSpec>>;
  /** True when a script or an agent can also run the command (default: only the person). */
  readonly agents?: boolean;
  /**
   * A key that is not a press. A "held" key acts while it is down, as the fly keys do. The part that owns it reads
   * its keys from the key map. A "modal" key is a key of one gesture, as Enter in a gizmo drag. The key map shows it
   * and does not change it. The key listener runs neither kind.
   */
  readonly keyKind?: KeyKind;
  /** Null when the command can run, else the reason. */
  when?(): string | null;
  run(args: Args): unknown;
}

/** The kinds of a key. A press runs a command, but a held key and a modal key do not (see `PageKeyCommandSpec`). */
export type KeyKind = "held" | "modal";

/** A page command in the registry: a view command with the parts of the key listener. */
type PageCommand = Command<RuleState, null, never> &
  Pick<PageKeyCommandSpec, "repeat" | "inText" | "inControls" | "keyKind">;

/** The scene commands of the edit mode as the key listener runs them (hierarchy/sceneCommands.ts). */
export interface SceneKeySource {
  /** The commands with their keys. */
  definitions(): readonly KeyCommand[];
  /** Null when the command can run (its selection rule and its condition), else the reason. */
  block(id: string): string | null;
  run(id: string): Promise<unknown>;
  /** True when a key must not reach the scene commands (for example, during a drag). */
  busy(): boolean;
  /** The result of a run (a refusal gives the reason). */
  done?(id: string, error: unknown): void;
  /** The commands, with the state "can run" of each. */
  listings(): readonly CommandListing[];
  /** Run a command with arguments for a person, a script or an agent. */
  execute(id: string, args: Readonly<Record<string, unknown>>, options?: CommandOptions): Promise<unknown>;
  /** The switch of the session: "apply" lets the edits of an agent apply immediately. */
  mode(): ProposalMode;
}

/** The commands of the open sequence (sequencer/pageSequence.ts). */
export interface SequenceCommandSource {
  listings(): readonly CommandListing[];
  run(id: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** A run of an actor. An agent run waits as a proposal (the switch of the session decides). */
  runAs?(id: string, args: Readonly<Record<string, unknown>>, options: CommandOptions): Promise<unknown>;
}

/** The source of a command of the window. */
export type CommandSourceName = "page" | "scene" | "sequence";

/** A command of the editor window as the search box, the menus, the script API and the agents list it. */
export interface WindowCommand extends CommandListing {
  readonly source: CommandSourceName;
}

/** The commands with their keys, as a settings panel lists them. */
export interface KeyCommandInfo {
  readonly id: string;
  readonly title: string;
  readonly context: string;
  readonly keys: readonly string[];
  readonly defaults: readonly string[];
  /** "press", or a held key or a modal key. */
  readonly keyKind: KeyKind | "press";
}

const NO_STATE: RuleState = { selection: null };

/** The keys of the page: the registry of the page commands, the scene commands and the one key listener. */
export class PageKeys {
  readonly registry = createCommandRegistry<RuleState, null, never>();
  #scene: SceneKeySource | null = null;
  #sequence: SequenceCommandSource | null = null;
  /** The report of a page command of the person that fails after its start (an async run). If null, the console. */
  failed: ((id: string, error: unknown) => void) | null = null;
  /** The call at the start of each run. It gets the command and its source (a key, a menu or a call). */
  ran: ((id: string, how: "key" | "menu" | "call") => void) | null = null;
  readonly #listeners = new Set<() => void>();

  /** Add page commands. A command with the ID of a registered command replaces it. The result removes them. */
  register(specs: readonly PageKeyCommandSpec[]): () => void {
    const ids = specs.map((spec) => spec.id);
    this.registry.unregister(ids);
    this.registry.register(specs.map(pageCommand));
    this.#changed();
    return () => {
      this.registry.unregister(ids);
      this.#changed();
    };
  }

  /** Connect the scene commands of the edit mode. The result disconnects them. */
  connectScene(source: SceneKeySource): () => void {
    this.#scene = source;
    this.#changed();
    return () => {
      if (this.#scene !== source) return;
      this.#scene = null;
      this.#changed();
    };
  }

  /** Connect the commands of the open sequence. The result disconnects them. */
  connectSequence(source: SequenceCommandSource): () => void {
    this.#sequence = source;
    this.#changed();
    return () => {
      if (this.#sequence !== source) return;
      this.#sequence = null;
      this.#changed();
    };
  }

  /** Each command of the editor window, with its current keys and its state "can run". */
  list(): WindowCommand[] {
    const map = this.keyMap();
    const of = (source: CommandSourceName, listings: readonly CommandListing[]): WindowCommand[] =>
      listings.map((listing) => ({ ...listing, keys: map.keysOf(listing.id), source }));
    return [
      // A held key and a modal key are not actions of the window, so the list does not include them.
      ...of(
        "page",
        this.registry
          .listings(NO_STATE)
          .filter((listing) => (this.registry.named(listing.id) as PageCommand | undefined)?.keyKind === undefined),
      ),
      ...of("scene", this.#scene?.listings() ?? []),
      ...of("sequence", this.#sequence?.listings() ?? []),
    ];
  }

  /**
   * Run a command of the window with its arguments. A run of a script or an agent (`options.by`) reaches only the
   * page commands for agents. An agent edit of the sequence waits as a proposal of the open sequence. It applies
   * immediately when the switch of the session is "apply". A refusal throws a CommandError with the reason.
   */
  async execute(
    id: string,
    args: Readonly<Record<string, unknown>> = {},
    options: CommandOptions = {},
  ): Promise<unknown> {
    const by = options.by ?? "owner";
    this.ran?.(id, "call");
    const page = this.registry.named(id);
    if (page !== undefined) {
      if (by !== "owner" && page.owner === true) throw new CommandError(`${id}: only the person runs this command.`);
      const outcome = this.registry.prepare(id, args, NO_STATE);
      return outcome.kind === "view" ? outcome.run(null) : null;
    }
    if (this.#scene?.listings().some((item) => item.id === id) === true) return this.#scene.execute(id, args, options);
    if (this.#sequence?.listings().some((item) => item.id === id) === true) {
      if (by !== "owner" && this.#sequence.runAs !== undefined) return this.#sequence.runAs(id, args, options);
      return this.#sequence.run(id, args);
    }
    throw new CommandError(`No command "${id}". scene_commands lists the commands of the editor window.`);
  }

  /** The commands of the key map: the page commands, then the scene commands. */
  commands(): KeyCommand[] {
    return [...this.registry.list(), ...(this.#scene?.definitions() ?? [])];
  }

  /** The current key map: the defaults of the commands and the key map of the user. */
  keyMap(): KeyMap {
    return createKeyMap(this.commands(), pageSettings().keymap);
  }

  /** The commands with their current keys. */
  infos(): KeyCommandInfo[] {
    const map = this.keyMap();
    return this.commands().map((command) => ({
      id: command.id,
      title: (command as { title?: string }).title ?? command.id,
      context: command.keyContext ?? GLOBAL_CONTEXT,
      keys: map.keysOf(command.id),
      defaults: map.defaultsOf(command.id),
      keyKind: (command as Partial<Pick<PageCommand, "keyKind">>).keyKind ?? "press",
    }));
  }

  /** Call `listener` after each change of the commands. The result stops it. */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Run a page command or a scene command by its ID (a menu, the status bar). The result is a refusal reason. */
  run(id: string): string | null {
    this.ran?.(id, "menu");
    const page = this.registry.named(id) as PageCommand | undefined;
    if (page !== undefined) {
      const reason = this.registry.block(page, NO_STATE);
      if (reason !== null) return reason;
      const outcome = this.registry.prepare(id, {}, NO_STATE);
      if (outcome.kind === "view") this.#report(id, outcome.run(null));
      return null;
    }
    const scene = this.#scene;
    const reason = scene === null ? t("settings-command-none", { id }) : scene.block(id);
    if (scene === null || reason !== null) return reason;
    scene.run(id).then(
      () => scene.done?.(id, null),
      (error: unknown) => scene.done?.(id, error),
    );
    return null;
  }

  /** Run the command of a key event. The result is true when a command took the key. */
  handle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) return false;
    const chord = chordOfEvent(event);
    if (chord === null) return false;
    const typing = typingInto(event.target);
    const text = typing && textEntry(event.target);
    for (const id of this.keyMap().commandsFor(chord, contextsOf(event.target))) {
      const page = this.registry.named(id) as PageCommand | undefined;
      if (page !== undefined) {
        // A held key and a modal key belong to the part that owns them.
        if (page.keyKind !== undefined) continue;
        const field = typing && page.inText !== true && (text || page.inControls !== true);
        if (field || (event.repeat && page.repeat !== true)) continue;
        if (this.registry.block(page, NO_STATE) !== null) continue;
        event.preventDefault();
        this.ran?.(id, "key");
        const outcome = this.registry.prepare(id, {}, NO_STATE);
        if (outcome.kind === "view") this.#report(id, outcome.run(null));
        return true;
      }
      const scene = this.#scene;
      if (scene === null || typing || event.repeat || scene.busy() || scene.block(id) !== null) continue;
      event.preventDefault();
      this.ran?.(id, "key");
      scene.run(id).then(
        () => scene.done?.(id, null),
        (error: unknown) => scene.done?.(id, error),
      );
      return true;
    }
    return false;
  }

  /** Report the failure of a run that returns a promise. */
  #report(id: string, result: unknown): void {
    if (!(result instanceof Promise)) return;
    result.catch((error: unknown) => {
      if (this.failed === null) console.warn(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      else this.failed(id, error);
    });
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** A page command of a spec: a view command whose condition is the condition of the spec. */
function pageCommand(spec: PageKeyCommandSpec): PageCommand {
  return {
    id: spec.id,
    title: spec.title,
    key: null,
    ...(spec.keys === undefined ? {} : { keys: spec.keys }),
    ...(spec.keyContext === undefined ? {} : { keyContext: spec.keyContext }),
    ...(spec.repeat === undefined ? {} : { repeat: spec.repeat }),
    ...(spec.inText === undefined ? {} : { inText: spec.inText }),
    ...(spec.inControls === undefined ? {} : { inControls: spec.inControls }),
    ...(spec.keyKind === undefined ? {} : { keyKind: spec.keyKind }),
    kind: "view",
    ...(spec.description === undefined ? {} : { description: spec.description }),
    ...(spec.icon === undefined ? {} : { icon: spec.icon }),
    ...(spec.category === undefined ? {} : { category: spec.category }),
    ...(spec.menu === undefined ? {} : { menu: spec.menu }),
    owner: spec.agents !== true,
    args: spec.args ?? {},
    selection: { kinds: [] },
    when: () => spec.when?.() ?? null,
    build: (args) => ({ kind: "view", title: spec.title, run: () => spec.run(args) }),
  };
}

/** The controls with no text. A key on them is not text (thus ⌘Z there undoes the scene). */
const NO_TEXT = new Set(["checkbox", "radio", "color", "button", "submit", "reset", "range", "file"]);

/** True when the focus takes text: a text area, an editable element, or an input of a text type. */
function textEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target instanceof HTMLInputElement && !NO_TEXT.has(target.type);
}

/**
 * The contexts of a key event target, the nearest first: the `data-key-context` values up to the page, then `scene`
 * outside the bottom dock, then `global`.
 */
export function contextsOf(target: EventTarget | null): string[] {
  const out: string[] = [];
  // A press on the content of a dock panel gives the focus to the content container of the dock (dockview). The
  // container holds the panel, so the context of that panel applies.
  const container = target instanceof Element && target.classList.contains("dv-content-container") ? target : null;
  const inner = container?.querySelector<HTMLElement>(":scope > * > [data-key-context], :scope > [data-key-context]");
  if (inner?.dataset.keyContext !== undefined) out.push(inner.dataset.keyContext);
  let node = target instanceof Element ? target : null;
  while (node !== null) {
    const context = node instanceof HTMLElement ? node.dataset.keyContext : undefined;
    if (context !== undefined && !out.includes(context)) out.push(context);
    node = node.parentElement;
  }
  if (!out.includes("dock")) out.push(SCENE_CONTEXT);
  out.push(GLOBAL_CONTEXT);
  return out;
}

let current: PageKeys | null = null;

/** The keys of the page. The first call starts the one key listener. */
export function pageKeys(): PageKeys {
  if (current === null) {
    const keys = new PageKeys();
    current = keys;
    window.addEventListener("keydown", (event) => {
      keys.handle(event);
    });
  }
  return current;
}
