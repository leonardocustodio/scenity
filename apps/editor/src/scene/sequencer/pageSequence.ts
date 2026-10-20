// SPDX-License-Identifier: Apache-2.0
/**
 * The open sequence of the scene page in the edit mode. It has no Vue, so the page makes it before the lazy panel
 * chunk loads. It has these parts:
 *
 * - the sequence channel of `@scenity/editor-core` in the one history of the page editor. Thus an undo restores the
 *   scene and the sequence together. Each change goes to the core of the page ("load" with `sequence`), so the page
 *   plays the edited sequence immediately.
 * - the record mode: the recorder of the scene channel keys an edit at the time of the clock.
 * - the commands of the sequencer (a registry and a runner, as the hierarchy commands have).
 * - the file state of the `*.sequence.json` file. The page editor saves it after the scene, through the same writer
 *   and the same rule gate.
 * - the posed view of the page editor: the scene at the time of the clock with the open sequence. Thus the gizmo and
 *   the inspector show the frame that the core draws. A loop of animation frames tells the editor about each new time
 *   of the clock.
 * - the proposals of the agents. A run of an agent (by "claude") waits as a proposal unless the switch of the session
 *   is "apply", as for a scene edit. The Timeline shows its keys as ghosts until the owner accepts it.
 */
import {
  CommandError,
  createCommandRegistry,
  readProposalMode,
  createRunner,
  EditError,
  editProblems,
  PosedView,
  SceneFile,
  sceneOpKind,
  sceneTextHash,
  SEQUENCE_CHANNEL,
  SEQUENCE_COMMANDS,
  SEQUENCE_OP,
  SequenceChannel,
  SequenceRecorder,
  type CommandHost,
  type CommandListing,
  type CommandOptions,
  type CommandRun,
  type Proposal,
  type OpContext,
  type Runner,
  type SequenceCommandState,
  type SequenceOp,
} from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { SceneRuleVerdict } from "@scenity/cli/sceneFileContract";
import type { PageEditorParts, PageSaveResult, ScenePageEditor } from "../sceneEditor";
import type { SceneFilePort } from "../sceneFiles";

/** The clock of the page as the sequencer drives it. */
export interface PageTime {
  now(): number;
  playing(): boolean;
  seek(t: number): void;
  play(): void;
  pause(): void;
  /** The speed of the clock (clock ms for each wall ms), and its change. If absent, the speed is always 1. */
  speed?(): number;
  setSpeed?(speed: number): void;
}

/** The parts of the page that the open sequence uses. */
export interface SequenceEditParts {
  /** The path of the sequence file in the project and its text at the load. */
  readonly path: string;
  readonly doc: SequenceDocument;
  readonly diskText: string;
  readonly time: PageTime;
  readonly files: SceneFilePort;
  /** Send a sequence to the core of the page; the promise ends after the frame that shows it. */
  load(doc: SequenceDocument): Promise<unknown>;
  /** The verdicts of the rules for a save of the sequence over the scene. If absent, a save carries no verdicts. */
  checkRules?(scene: SceneDocument, sequence: SequenceDocument): Promise<readonly SceneRuleVerdict[]>;
}

/** The sequence part of the script API of the scene page. */
export interface SequenceApi {
  /** The open sequence. */
  sequence(): SequenceDocument;
  /** Run a command of the sequencer and wait for the frame that shows the new sequence. */
  sequenceCommand(id: string, args?: Readonly<Record<string, unknown>>): Promise<CommandRun<SequenceOp>>;
  sequenceCommands(): CommandListing[];
  /** Enable or disable the record mode (with no argument, only read it). The result is the current state. */
  record(on?: boolean): boolean;
}

const NO_TUNES: OpContext = { known: () => false, defaults: new Map() };

export class PageSequence {
  readonly channel: SequenceChannel;
  readonly recorder: SequenceRecorder<SceneDocument>;
  readonly file: SceneFile;
  readonly #parts: SequenceEditParts;
  readonly #recordListeners = new Set<(on: boolean) => void>();
  /** The proposals of the agents that wait, and the listeners of their changes. */
  #proposals: readonly Proposal<SequenceOp>[] = [];
  readonly #proposalListeners = new Set<(proposals: readonly Proposal<SequenceOp>[]) => void>();
  #editor: ScenePageEditor | null = null;
  #runner: Runner<SequenceOp> | null = null;
  #next: SequenceDocument | null = null;
  #sent: Promise<void> = Promise.resolve();
  #busy = false;

  constructor(parts: SequenceEditParts) {
    this.#parts = parts;
    this.file = new SceneFile(parts.path, parts.doc, parts.diskText);
    this.channel = new SequenceChannel({
      doc: parts.doc,
      send: (doc) => {
        this.#send(doc);
      },
      onChange: () => this.#editor?.changed(),
    });
    this.recorder = new SequenceRecorder<SceneDocument>(this.channel, () => parts.time.now());
  }

  get time(): PageTime {
    return this.#parts.time;
  }

  get path(): string {
    return this.#parts.path;
  }

  /** The parts of the page editor: the sequence channel of the one history and its op kind. */
  editorParts(): Pick<PageEditorParts, "channels" | "kinds"> {
    return { channels: { [SEQUENCE_CHANNEL]: this.channel.channel }, kinds: [SEQUENCE_OP] };
  }

  /** Connect the page editor: the recorder, the save of the file and the runner of the commands. */
  connect(editor: ScenePageEditor): void {
    this.#editor = editor;
    editor.channel.recorder = this.recorder;
    editor.attach({ dirty: () => this.dirty(), save: (force, reason) => this.save(force, reason) });
    this.#runner = this.#makeRunner(editor);
    const view = new PosedView(editor.registry);
    editor.setPose((doc) => view.at(doc, this.channel.doc, this.#parts.time.now()));
    this.channel.listen(() => editor.tickPose());
    const tick = (): void => {
      editor.tickPose();
      globalThis.requestAnimationFrame(tick);
    };
    if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(tick);
  }

  get editor(): ScenePageEditor {
    if (this.#editor === null) throw new Error("the sequence has no page editor yet");
    return this.#editor;
  }

  dirty(): boolean {
    return this.file.dirty(this.channel.doc);
  }

  /** The current record mode, and a change of it. */
  get recording(): boolean {
    return this.recorder.on;
  }

  setRecording(on: boolean): void {
    if (this.recorder.on === on) return;
    this.recorder.on = on;
    for (const listener of this.#recordListeners) listener(on);
  }

  listenRecord(listener: (on: boolean) => void): () => void {
    this.#recordListeners.add(listener);
    return () => this.#recordListeners.delete(listener);
  }

  /** Run a command of the sequencer as the owner (it applies immediately). A refusal throws a CommandError. */
  run(id: string, args: Readonly<Record<string, unknown>> = {}): Promise<CommandRun<SequenceOp>> {
    if (this.#runner === null) throw new Error("the sequence has no page editor yet");
    // The lock of a viewer of the studio also locks the sequence.
    const lock = this.#editor?.channel.lock ?? null;
    if (lock !== null) return Promise.reject(new CommandError(lock));
    return this.#runner.run(id, args, { by: "owner" });
  }

  /** Run a command as an actor. A run of an agent obeys the proposal rule of the session. */
  runAs(id: string, args: Readonly<Record<string, unknown>>, options: CommandOptions): Promise<CommandRun<SequenceOp>> {
    if (this.#runner === null) throw new Error("the sequence has no page editor yet");
    return this.#runner.run(id, args, options);
  }

  /** The proposals of the agents that wait. */
  proposals(): readonly Proposal<SequenceOp>[] {
    return this.#proposals;
  }

  /** Call `listener` after each change of the proposals. The result stops it. */
  listenProposals(listener: (proposals: readonly Proposal<SequenceOp>[]) => void): () => void {
    this.#proposalListeners.add(listener);
    return () => this.#proposalListeners.delete(listener);
  }

  /** Accept or reject each proposal that waits. Each accepted proposal is one step of the history. */
  acceptAll(): void {
    this.#runner?.acceptAll();
  }

  rejectAll(): void {
    this.#runner?.rejectAll();
  }

  listings(): CommandListing[] {
    return this.#runner?.listings() ?? [];
  }

  /** Wait until the core of the page shows the current sequence. */
  settled(): Promise<void> {
    return this.#sent;
  }

  /** Save the sequence file through the port (the rule results of the page go with it). */
  async save(force: boolean, reason: string): Promise<PageSaveResult> {
    const doc = this.channel.doc;
    const request = this.file.saveRequest(doc, force);
    const verdicts = await this.#parts.checkRules?.(this.editor.doc, doc);
    const result = await this.#parts.files.save({
      ...request,
      ...(verdicts === undefined ? {} : { checks: { hash: sceneTextHash(request.text), verdicts } }),
      ...(reason === "" ? {} : { reason }),
    });
    if (result.ok) this.file.saved(result.text, result.hash);
    return result;
  }

  /** The script API of the sequence. `frame` waits for the next frame of the core. */
  api(frame: () => Promise<void>): SequenceApi {
    return {
      sequence: () => this.channel.doc,
      sequenceCommand: async (id, args) => {
        const run = await this.run(id, args);
        await this.settled();
        await frame();
        return run;
      },
      sequenceCommands: () => this.listings(),
      record: (on) => {
        if (on !== undefined) this.setRecording(on);
        return this.recording;
      },
    };
  }

  /** Send the newest sequence to the core: one load at a time, and only the last of the changes that wait. */
  #send(doc: SequenceDocument): void {
    this.#next = doc;
    if (this.#busy) return;
    this.#busy = true;
    this.#sent = this.#flush();
  }

  async #flush(): Promise<void> {
    while (this.#next !== null) {
      const doc = this.#next;
      this.#next = null;
      await this.#parts.load(doc).catch((error: unknown) => {
        console.warn(`the core refused the sequence: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    this.#busy = false;
  }

  /** The cell of the proposals. A write tells the listeners. */
  #proposalCell(): { value: readonly Proposal<SequenceOp>[] } {
    const read = (): readonly Proposal<SequenceOp>[] => this.#proposals;
    const write = (next: readonly Proposal<SequenceOp>[]): void => {
      this.#proposals = next;
      for (const listener of this.#proposalListeners) listener(next);
    };
    return {
      get value() {
        return read();
      },
      set value(next) {
        write(next);
      },
    };
  }

  #makeRunner(editor: ScenePageEditor): Runner<SequenceOp> {
    const registry = createCommandRegistry<SequenceCommandState, CommandHost, SequenceOp>();
    registry.register(SEQUENCE_COMMANDS);
    const kinds = [sceneOpKind(editor.registry), SEQUENCE_OP];
    return createRunner<SequenceCommandState, CommandHost, SequenceOp>({
      registry,
      state: () => ({
        selection: null,
        scene: editor.doc,
        sequence: this.channel.doc,
        time: Math.round(this.#parts.time.now()),
      }),
      host: { select: () => undefined, undo: () => editor.channel.undo(), redo: () => editor.channel.redo() },
      apply: (edit) => {
        try {
          const result = editor.channel.apply(edit);
          return { step: result.applied, pending: result.pending, sent: [] };
        } catch (error) {
          if (error instanceof EditError) throw new CommandError(error.message);
          throw error;
        }
      },
      problems: (edit) => editProblems(edit, kinds, NO_TUNES),
      // The proposals of the agents, and the switch of the session (the same switch as for the scene commands).
      proposals: this.#proposalCell(),
      mode: {
        get value() {
          return readProposalMode();
        },
        set value(_mode) {
          // The switch of the session belongs to the scene commands (sceneCommands.ts).
        },
      },
      keepMode: () => undefined,
    });
  }
}
