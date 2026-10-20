// SPDX-License-Identifier: Apache-2.0
/**
 * The edit history: one undo and redo for all edits. The edit state is a set of channels: the scene document, the tune
 * values, the events of edits, the scratch list, or a channel of a plugin. A step of the history keeps the value of
 * each channel. Thus an undo restores all of them together:
 *
 * - an edit (ops.ts) is one step for all of its ops;
 * - a change of a channel outside an edit (a field of a panel, a scratch move) is one step (`note`);
 * - a drag is one step: `hold` stops the steps while the drag runs, and `release` keeps only its end.
 *
 * The documents of the scene ops share each branch that does not change. Thus a step costs little. No Vue import.
 */
import {
  applyEditOps,
  EditError,
  pendingRuns,
  type Actor,
  type BaseOp,
  type Edit,
  type OpContext,
  type OpKind,
  type PendingRun,
} from "./ops";

/** The most steps that a history keeps. */
export const HISTORY_STEPS = 100;

/**
 * A history of any state: a list of states and the index of the current state. A new state after an undo removes the
 * redo steps. The oldest state goes when the list is full.
 */
export class StateHistory<S> {
  private readonly states: S[];
  private index = 0;
  /** The last jump (`goTo`). One undo or redo returns to its start. */
  private jump: { readonly from: number; readonly to: number } | null = null;

  constructor(
    start: S,
    private readonly same: (a: S, b: S) => boolean,
    private readonly copy: (state: S) => S,
    private readonly max = HISTORY_STEPS,
  ) {
    this.states = [copy(start)];
  }

  /** Record a new state after the current state. The states after it (the redo steps) go. */
  record(state: S): void {
    const now = this.states[this.index];
    if (now !== undefined && this.same(now, state)) return;
    this.states.splice(this.index + 1);
    this.states.push(this.copy(state));
    if (this.states.length > this.max) this.states.shift();
    this.index = this.states.length - 1;
    this.jump = null;
  }

  /** The state before the current state, or null at the start. After a jump forward, the state at the jump start. */
  undo(): S | null {
    const back = this.backOfJump(true);
    if (back !== null) return back;
    if (this.index === 0) return null;
    this.index -= 1;
    return this.at(this.index);
  }

  /** The state after the current state, or null at the end. After a jump back, the state at the jump start. */
  redo(): S | null {
    const back = this.backOfJump(false);
    if (back !== null) return back;
    if (this.index >= this.states.length - 1) return null;
    this.index += 1;
    return this.at(this.index);
  }

  /**
   * Go to the state at an index in one action. Null for an index out of the list (or the current state). The states
   * stay: after a jump back, one redo returns. After a jump forward, one undo returns.
   */
  goTo(index: number): S | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.states.length || index === this.index) return null;
    this.jump = { from: this.index, to: index };
    this.index = index;
    return this.at(index);
  }

  /** The current state, not a copy. The caller must not change it. */
  peek(): S {
    const state = this.states[this.index];
    if (state === undefined) throw new Error("The history has no state.");
    return state;
  }

  /** A copy of the states and the index of the current state. */
  list(): { readonly states: S[]; readonly index: number } {
    return { states: this.states.map(this.copy), index: this.index };
  }

  /** A mark of the list and of the current index. `rewind` restores them. The mark does not copy the states again. */
  mark(): StateMark<S> {
    return { states: [...this.states], index: this.index };
  }

  /** Restore the list and the index of a mark. The states after the mark go. */
  rewind(mark: StateMark<S>): void {
    this.states.splice(0, this.states.length, ...mark.states);
    this.index = mark.index;
    this.jump = null;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.states.length - 1;
  }

  /** The state at the start of the last jump, for an undo (`undo` true) of a jump forward or a redo of a jump back. */
  private backOfJump(undo: boolean): S | null {
    const jump = this.jump;
    this.jump = null;
    if (jump?.to !== this.index || jump.from < jump.to !== undo) return null;
    this.index = jump.from;
    return this.at(jump.from);
  }

  private at(index: number): S | null {
    const state = this.states[index];
    return state === undefined ? null : this.copy(state);
  }
}

/** A mark of a state history (the list and the index of the current state). */
export interface StateMark<S> {
  readonly states: readonly S[];
  readonly index: number;
}

/** A mark of an edit history: its steps, and the values of the channels at the time of the mark. */
export interface HistoryMark {
  readonly steps: StateMark<HistoryStep>;
  readonly values: Readonly<Record<string, unknown>>;
}

/** One part of the edit state that the history keeps. */
export interface Channel<V> {
  /** The name of a step that changes only this channel outside an edit, for example "tune values". */
  readonly title?: string;
  read(): V;
  /** Write a value of a step (`now` is the value before). The history writes each channel on an undo and a redo. */
  write(next: V, now: V): void;
  same(a: V, b: V): boolean;
  /** A copy that a later change of the live value does not change. Absent: the value itself (an immutable value). */
  copy?(value: V): V;
}

/** The name of a step: the edit that made it, or the change of a channel (`id` null). */
export interface StepLabel {
  readonly id: string | null;
  readonly title: string;
  /** Who made the step (absent: the person). */
  readonly actor?: Actor;
}

/** One step of the history: the values of the channels and its name (null for the start). */
export interface HistoryStep {
  readonly values: Readonly<Record<string, unknown>>;
  readonly label: StepLabel | null;
}

/** The result of an edit: a step of the history or no change, and its source ops as pending runs. */
export interface EditResult {
  /** True when the ops changed a channel (one step of the history). */
  readonly applied: boolean;
  readonly pending: readonly PendingRun[];
}

/** The history of the edit state over its channels. */
export class EditHistory {
  private readonly history: StateHistory<HistoryStep>;
  private holding = false;
  private writing = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly channels: Readonly<Record<string, Channel<unknown>>>,
    max = HISTORY_STEPS,
  ) {
    this.history = new StateHistory<HistoryStep>(
      { values: this.read(), label: null },
      (a, b) => this.sameValues(a.values, b.values),
      (step) => ({ values: this.copyValues(step.values), label: step.label }),
      max,
    );
  }

  /** True while the history writes the channels (an undo, a redo, an edit). A watch of a channel ignores the change. */
  get restoring(): boolean {
    return this.writing;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** Call `listener` after each change of the steps or of the current step. The result stops it. */
  listen(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The current values of the channels. */
  read(): Record<string, unknown> {
    return Object.fromEntries(Object.entries(this.channels).map(([name, channel]) => [name, channel.read()]));
  }

  /**
   * Record the current values as one step: a change of a channel outside an edit. Nothing occurs while the history
   * holds (a drag) or writes. The name of the step is the title of the first channel that changed.
   */
  note(): void {
    if (this.holding || this.writing) return;
    const values = this.read();
    const now = this.history.peek().values;
    const changed = Object.keys(this.channels).find((name) => !this.channel(name).same(now[name], values[name]));
    if (changed === undefined) return;
    this.history.record({ values, label: { id: null, title: this.channels[changed]?.title ?? changed } });
    this.changed();
  }

  /** A drag starts: its changes are not steps until `release`. */
  hold(): void {
    this.holding = true;
  }

  /** The drag ends: its last state is one step. */
  release(): void {
    this.holding = false;
    this.note();
  }

  /**
   * Apply an edit as one step: the ops change the values of their channels, and the history writes the channels that
   * changed. An op that the editor refuses throws an EditError and changes nothing.
   */
  apply<O extends BaseOp>(edit: Edit<O>, kinds: readonly OpKind[], context: OpContext): EditResult {
    const now = this.read();
    const { values, touched } = applyEditOps(now, edit.ops, kinds, context);
    const changed = touched.filter((name) => !this.channel(name).same(now[name], values[name]));
    const pending = pendingRuns(edit);
    if (changed.length === 0) return { applied: false, pending };
    this.writing = true;
    try {
      for (const name of changed) this.channel(name).write(values[name], now[name]);
    } finally {
      this.writing = false;
    }
    const actor = edit.actor === undefined ? {} : { actor: edit.actor };
    this.history.record({ values: this.read(), label: { id: edit.id, title: edit.title, ...actor } });
    this.changed();
    return { applied: true, pending };
  }

  /** Go one step back. False at the start. */
  undo(): boolean {
    return this.restore(this.history.undo());
  }

  /** Go one step forward. False at the end. */
  redo(): boolean {
    return this.restore(this.history.redo());
  }

  /** Go to a step of `steps()` in one action. One redo (or undo) cancels it. False for no change. */
  goTo(index: number): boolean {
    if (this.holding) return false;
    return this.restore(this.history.goTo(index));
  }

  /**
   * A mark of the current history (the play mode). `rewind` restores the steps and the values of the channels of the
   * mark. Thus the steps after the mark go, and an undo gives the steps before it.
   */
  mark(): HistoryMark {
    return { steps: this.history.mark(), values: this.copyValues(this.read()) };
  }

  /** Restore the steps and the values of a mark. The history writes each channel. */
  rewind(mark: HistoryMark): void {
    this.holding = false;
    this.history.rewind(mark.steps);
    this.restore({ values: this.copyValues(mark.values), label: null });
    this.changed();
  }

  /**
   * Merge the steps after a mark into one step with a label (a batch of edits that is one undo step). The current
   * values of the channels stay. True when the values differ from the mark (one step), else no step.
   */
  squash(mark: HistoryMark, label: StepLabel): boolean {
    const now = this.read();
    this.history.rewind(mark.steps);
    const changed = Object.keys(this.channels).some((name) => !this.channel(name).same(mark.values[name], now[name]));
    if (changed) this.history.record({ values: now, label });
    this.changed();
    return changed;
  }

  /** The steps and the index of the current step. Step 0 is the oldest step that the history keeps. */
  steps(): { readonly index: number; readonly steps: readonly HistoryStep[] } {
    const { states, index } = this.history.list();
    return { index, steps: states };
  }

  private restore(step: HistoryStep | null): boolean {
    if (step === null) return false;
    const now = this.read();
    this.writing = true;
    try {
      for (const name of Object.keys(this.channels)) this.channel(name).write(step.values[name], now[name]);
    } finally {
      this.writing = false;
    }
    this.changed();
    return true;
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private channel(name: string): Channel<unknown> {
    const channel = this.channels[name];
    if (channel === undefined) throw new EditError(`The editor has no channel "${name}".`);
    return channel;
  }

  private sameValues(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
    return Object.entries(this.channels).every(([name, channel]) => channel.same(a[name], b[name]));
  }

  private copyValues(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this.channels).map(([name, channel]) => {
        const value = values[name];
        return [name, channel.copy === undefined ? value : channel.copy(value)];
      }),
    );
  }
}
