// SPDX-License-Identifier: Apache-2.0
/**
 * The editor of the scene page. The open scene document is state of the editor: the scene channel of
 * `@scenity/editor-core` keeps it with one history, and each change goes to the runtime as a "patch" message. In the
 * edit mode (`edit=1`) the editor also keeps the file state:
 *
 * - the dirty state in the file bar and in the page title;
 * - a local draft of a dirty document in the browser storage; the next load offers it (Restore or Discard);
 * - a save through the scene file port (the canonical text and the base hash); a file that changed on the disk after
 *   the load gives a notice with Reload and Overwrite. A focus of the window checks the disk too.
 *
 * The view state of the hierarchy panel (solo and lock) is a second channel of the one history. The runtime draws the
 * document with the view overlay (`ViewLayer`), and the saved file never holds the view state.
 *
 * Before a save, the page evaluates the rules on its scene (pageRules.ts) and sends the verdicts with the save. A
 * failed `block` rule stops the save: the notice names the rules and asks for a reason. "Save with the reason" sends
 * the save again with the reason, and the writer keeps the reason in the log next to the scene.
 *
 * The page can give more channels of the one history (the open sequence) and attach more files to the save (the
 * sequence file): the file bar shows them dirty, and Save writes each dirty file after the scene.
 *
 * The play mode (`PlaySession` of `@scenity/editor-core`): while it runs, an edit changes only the play state. The file
 * bar shows the dirty state of the edit state, and the editor keeps no draft and refuses a save. Stop restores the edit
 * state, and Keep applies the chosen changes as one step. The posed view gives the scene at the time of the clock
 * (`posed`), so the gizmo and the inspector show the frame that the core draws.
 *
 * With a prefab set (prefabs/pagePrefabs.ts), the runtime draws the expanded document: each instance gets the entities
 * of its prefab. The patches stay ops on the document. The prefab set is a channel of the one history. Thus an apply of
 * overrides to a prefab is one step for the scene and the prefab. A change of the set goes to the runtime after the
 * patches before it. `expanded` gives the same expansion on the page (the hierarchy, the selection).
 *
 * The texts of the file state and of the notices are Fluent messages of `src/i18n/en-US/scene.ftl`.
 */
import { builtinRegistry, diffDocuments, readDocument, type ComponentRegistry, type SceneOp } from "@scenity/scene";
import { diffDetails, diskDetails } from "./sceneDiff";
import type { DialogDetails } from "../studio/shell/dialogs";
import { PrefabSetState } from "./prefabs/prefabSetState";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import {
  draftOffer,
  EditError,
  PlaySession,
  sameView,
  SceneChannel,
  SceneFile,
  sceneTextHash,
  VIEW_CHANNEL,
  VIEW_OP,
  ViewLayer,
  PREFAB_CHANNEL,
  prefabOpKind,
  type PrefabExpander,
  type PrefabSet,
  type Channel,
  type EditResult,
  type OpKind,
  type SceneDrafts,
  type SceneView,
} from "@scenity/editor-core";
import type { SceneRuleChecks, SceneRuleVerdict, SceneSaveResult } from "@scenity/cli/sceneFileContract";
import type { PatchResult } from "@scenity/runtime/protocol";
import { t } from "../texts";
import type { BarNotice, SceneBar } from "./sceneBar";
import type { SceneFilePort } from "./sceneFiles";

/** The parts of the editor. Without `files`, `drafts` and `bar` the editor has no file state (no edit mode). */
export interface PageEditorParts {
  readonly patch: (ops: readonly SceneOp[]) => Promise<PatchResult>;
  readonly doc: SceneDocument;
  /** The path of the scene file in the project and its text at the load. */
  readonly path: string;
  readonly diskText: string;
  readonly files?: SceneFilePort;
  readonly drafts?: SceneDrafts;
  readonly bar?: SceneBar;
  /** The time for the drafts (ms since 1970). */
  readonly now?: () => number;
  /** A reload of the page (the Reload action). */
  readonly reload?: () => void;
  /** The components of the engine and of the project plugins (default: the built-in components). */
  readonly registry?: ComponentRegistry;
  /** The verdicts of the rules on the scene of a document (pageRules.ts). Absent: a save carries none. */
  readonly checkRules?: (doc: SceneDocument) => Promise<readonly SceneRuleVerdict[]>;
  /** More channels of the one history and the op kinds of their edits (the open sequence). */
  readonly channels?: Readonly<Record<string, Channel<unknown>>>;
  readonly kinds?: readonly OpKind[];
  /** The prefab set of the page, its expansion, and the send of a new set to the runtime. */
  readonly prefabs?: {
    readonly expander: PrefabExpander;
    readonly set: PrefabSet;
    readonly send?: (set: PrefabSet) => Promise<unknown>;
  };
}

/** Another file of the page that the save writes after the scene (the open sequence). */
export interface AttachedFile {
  dirty(): boolean;
  save(force: boolean, reason: string): Promise<PageSaveResult>;
}

/** The result of a save of the page: the result of the port, or a refusal of the page itself. */
export type PageSaveResult =
  SceneSaveResult | { readonly ok: false; readonly conflict: false; readonly reason: string };

const builtins = builtinRegistry();

export class ScenePageEditor {
  readonly channel: SceneChannel<SceneDocument>;
  readonly file: SceneFile;
  readonly registry: ComponentRegistry;
  /** The play mode of the editor. */
  readonly play: PlaySession;
  readonly #parts: PageEditorParts;
  readonly #listeners = new Set<(doc: SceneDocument) => void>();
  readonly #viewListeners = new Set<(view: SceneView) => void>();
  /** The listeners of a save that wrote the scene (its text and hash). */
  readonly #savedListeners = new Set<(text: string, hash: string) => void>();
  readonly #layer: ViewLayer<SceneDocument>;
  readonly #attached: AttachedFile[] = [];
  #patched: Promise<void> = Promise.resolve();
  #error: string | null = null;
  #saving = false;
  /** The dirty state of the edit state at the start of the play mode. */
  #playDirty = false;
  /** The posed view (the scene at the time of the clock), or null with no sequence. */
  #pose: ((doc: SceneDocument) => SceneDocument) | null = null;
  readonly #poseListeners = new Set<() => void>();
  /** The expansion of the prefab instances, or null. The current prefab set is in prefabSetState.ts. */
  readonly expander: PrefabExpander | null;
  readonly #prefabs: PrefabSetState;

  constructor(parts: PageEditorParts) {
    this.#parts = parts;
    this.registry = parts.registry ?? builtins;
    this.file = new SceneFile(parts.path, parts.doc, parts.diskText);
    this.expander = parts.prefabs?.expander ?? null;
    this.#prefabs = new PrefabSetState(parts.prefabs?.set ?? {}, (set) => {
      const send = this.#parts.prefabs?.send;
      if (send !== undefined) this.#patched = this.#patched.then(() => send(set).then(() => undefined));
      this.#show();
    });
    const expander = this.expander;
    this.#layer = new ViewLayer(parts.doc);
    this.channel = new SceneChannel<SceneDocument>({
      doc: parts.doc,
      registry: this.registry,
      patch: (ops) => {
        this.#queue(this.#layer.docOps(this.channel.doc, ops));
      },
      onChange: (doc) => {
        if (!this.channel.live) this.changed();
        for (const listener of this.#listeners) listener(doc);
      },
      channels: {
        [VIEW_CHANNEL]: {
          title: t("scene-history-view"),
          read: () => this.#layer.view,
          write: (next) => {
            this.#queue(this.#layer.viewOps(next as SceneView));
            for (const listener of this.#viewListeners) listener(this.#layer.view);
          },
          same: (a, b) => sameView(a as SceneView, b as SceneView),
        },
        ...parts.channels,
        ...(expander === null ? {} : { [PREFAB_CHANNEL]: this.#prefabs.channel() }),
      },
      kinds: [VIEW_OP, ...(parts.kinds ?? []), ...(expander === null ? [] : [prefabOpKind(this.registry)])],
    });
    this.play = new PlaySession(this.channel);
    // The first state does not touch the draft: `offerDraft` reads it first.
    this.#show();
  }

  get doc(): SceneDocument {
    return this.channel.doc;
  }

  /** The current prefab set (the prefab documents by their path in the project). */
  get prefabs(): PrefabSet {
    return this.#prefabs.set;
  }

  /** The document with each prefab instance expanded (no view overlay): the entities that the runtime has. */
  get expanded(): SceneDocument {
    return this.expander?.expand(this.channel.doc, this.#prefabs.set) ?? this.channel.doc;
  }

  /** Add prefabs to the set with no step of the history (a new instance, a new prefab), and send them. */
  usePrefabs(prefabs: PrefabSet): void {
    this.#prefabs.add(prefabs);
  }

  /** Call `listener` after each change of the prefab set (an apply, an undo, a redo); the result stops it. */
  listenPrefabs(listener: (set: PrefabSet) => void): () => void {
    return this.#prefabs.listen(listener);
  }

  get dirty(): boolean {
    if (this.play.active) return this.#playDirty;
    return this.file.dirty(this.channel.doc) || this.#attached.some((file) => file.dirty());
  }

  /** Save `file` with the scene; the file bar shows its dirty state too. */
  attach(file: AttachedFile): void {
    this.#attached.push(file);
    this.#show();
  }

  /** Call `listener` after each save that wrote the scene; the result stops it. */
  listenSaved(listener: (text: string, hash: string) => void): () => void {
    this.#savedListeners.add(listener);
    return () => this.#savedListeners.delete(listener);
  }

  /** Call `listener` after each change of the document (an edit, a live op, an undo, a redo). */
  listen(listener: (doc: SceneDocument) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The current view state (solo and lock). */
  get view(): SceneView {
    return this.#layer.view;
  }

  /** Call `listener` after each change of the view state; the result stops it. */
  listenView(listener: (view: SceneView) => void): () => void {
    this.#viewListeners.add(listener);
    return () => this.#viewListeners.delete(listener);
  }

  /** Wait until the runtime answers each patch that the editor sent. */
  settled(): Promise<void> {
    return this.#patched;
  }

  /** Apply scene ops as one step of the history; the reason of a refusal, or null. */
  apply(ops: readonly SceneOp[], title = t("scene-history-edit")): string | null {
    try {
      this.channel.edit(ops, title);
      return null;
    } catch (error) {
      if (error instanceof EditError) return error.message;
      throw error;
    }
  }

  /** Start the play mode; the reason of a refusal, or null. */
  enterPlay(): string | null {
    const dirty = this.dirty;
    try {
      this.play.enter();
    } catch (error) {
      if (error instanceof EditError) return error.message;
      throw error;
    }
    this.#playDirty = dirty;
    this.#show();
    return null;
  }

  /** Stop the play mode and restore the edit state. */
  stopPlay(): void {
    this.play.stop();
    this.changed();
  }

  /** Stop the play mode and keep the changes with the IDs `ids` (all with no IDs) as one step. */
  keepPlay(ids?: readonly string[]): EditResult {
    const result = this.play.keep(ids);
    this.changed();
    return result;
  }

  /** Set the posed view: a function of the base scene that gives the scene at the time of the clock. */
  setPose(pose: ((doc: SceneDocument) => SceneDocument) | null): void {
    this.#pose = pose;
    this.tickPose();
  }

  /** The scene at the time of the clock (the base scene with no posed view). */
  posed(): SceneDocument {
    return this.#pose?.(this.channel.doc) ?? this.channel.doc;
  }

  /** Call `listener` when the posed scene changes (an edit, or a new time of the clock); the result stops it. */
  listenPosed(listener: (doc: SceneDocument) => void): () => void {
    let last: SceneDocument | null = null;
    const tell = (): void => {
      const next = this.posed();
      if (next === last) return;
      last = next;
      listener(next);
    };
    this.#poseListeners.add(tell);
    const stop = this.listen(tell);
    return () => {
      stop();
      this.#poseListeners.delete(tell);
    };
  }

  /** Tell the listeners of the posed scene about a new time of the clock (the page calls it each frame). */
  tickPose(): void {
    for (const tell of this.#poseListeners) tell();
  }

  /** Show the file state again and keep the draft: after each change and after the end of a drag. */
  changed(): void {
    const { drafts } = this.#parts;
    // The play state never goes into the draft.
    if (this.play.active) {
      this.#show();
      return;
    }
    if (this.file.dirty(this.channel.doc)) drafts?.write(this.file, this.channel.doc, (this.#parts.now ?? Date.now)());
    else drafts?.clear();
    this.#show();
  }

  #show(): void {
    const dirty = this.dirty;
    const state = dirty ? t("scene-state-unsaved") : t("scene-state-saved");
    this.#parts.bar?.state(this.#saving ? t("scene-state-saving") : (this.#error ?? state), dirty);
  }

  /**
   * Save the document through the port. `force` writes also over a file that changed on the disk. `reason` is the
   * reason of the owner to save while a `block` rule fails.
   */
  async save(force = false, reason?: string): Promise<PageSaveResult> {
    const { files, bar } = this.#parts;
    const refuse = (words: string): PageSaveResult => ({ ok: false, conflict: false, reason: words });
    if (files === undefined) return refuse(t("scene-save-no-edit-mode"));
    if (this.channel.live) return refuse(t("scene-save-drag"));
    if (this.play.active) return refuse(t("scene-save-play"));
    const doc = this.channel.doc;
    const request = this.file.saveRequest(doc, force);
    this.#saving = true;
    this.changed();
    let result: PageSaveResult;
    try {
      const checks = await this.#checks(doc, request.text);
      const why = reason?.trim() ?? "";
      result = await files.save({
        ...request,
        ...(checks === null ? {} : { checks }),
        ...(why === "" ? {} : { reason: why }),
      });
      // The saved scene is immediately the new base, so a refusal of an attached file keeps it.
      if (result.ok) this.file.saved(result.text, result.hash);
      if (result.ok) result = (await this.#saveAttached(force, why)) ?? result;
    } catch (error) {
      result = { ok: false, conflict: false, reason: error instanceof Error ? error.message : String(error) };
    }
    this.#saving = false;
    const blocked = !result.ok && !result.conflict && "blocked" in result;
    this.#error =
      result.ok || result.conflict
        ? null
        : blocked
          ? t("scene-state-rule-fails")
          : t("scene-state-not-saved", { reason: result.reason });
    if (result.ok) {
      this.file.saved(result.text, result.hash);
      for (const listener of this.#savedListeners) listener(result.text, result.hash);
      bar?.notice(null);
    } else if (result.conflict) await this.#showConflict();
    else if (blocked) bar?.notice(this.#rulesNotice(result.reason, force));
    this.changed();
    return result;
  }

  /** Save each dirty attached file; the first result that is not ok, or null. */
  async #saveAttached(force: boolean, reason: string): Promise<PageSaveResult | null> {
    for (const file of this.#attached) {
      if (!file.dirty()) continue;
      const result = await file.save(force, reason);
      if (!result.ok) return result;
    }
    return null;
  }

  /** The verdicts of the rules on the scene of `doc`, for the save of `text`; null with no rule check. */
  async #checks(doc: SceneDocument, text: string): Promise<SceneRuleChecks | null> {
    const check = this.#parts.checkRules;
    if (check === undefined) return null;
    // After the sent patches, the core has the document of the save.
    await this.settled();
    return { hash: sceneTextHash(text), verdicts: await check(doc) };
  }

  /** The notice of a save that a failed rule stopped: the rules, a reason field, Save with the reason. */
  #rulesNotice(words: string, force: boolean): BarNotice {
    return {
      kind: "rules",
      text: t("scene-rules-notice", { reason: words }),
      input: { placeholder: t("scene-rules-reason"), testId: "rules-reason" },
      first: { label: t("scene-rules-save"), testId: "rules-save", run: (text) => void this.save(force, text) },
      second: { label: t("scene-notice-cancel"), testId: "rules-cancel", run: () => this.#parts.bar?.notice(null) },
    };
  }

  /** At the load: offer the local draft when it differs from the file. */
  offerDraft(): void {
    const { drafts, bar } = this.#parts;
    const offer = draftOffer(drafts?.read() ?? null, this.file);
    if (offer === null || bar === undefined) return;
    const time = new Date(offer.draft.savedMs).toLocaleString();
    // The recovery dialog shows the changes of the draft on request.
    const read = readDocument(offer.draft.text, this.file.path.endsWith(".prefab.json") ? "prefab" : "scene", {
      registry: this.registry,
    });
    const details = read.ok ? diffDetails(t("scene-draft-changes"), this.channel.doc, read.doc, this.registry) : null;
    bar.notice({
      kind: "draft",
      text: offer.stale ? t("scene-draft-offer-stale", { time }) : t("scene-draft-offer", { time }),
      ...(details === null ? {} : { details }),
      first: { label: t("scene-draft-restore"), testId: "draft-restore", run: () => this.restoreDraft() },
      second: {
        label: t("scene-draft-discard"),
        testId: "draft-discard",
        run: () => {
          drafts?.clear();
          bar.notice(null);
        },
      },
    });
  }

  /** Put the document of the local draft in the editor as one step of the history; the reason of a refusal. */
  restoreDraft(): string | null {
    const draft = this.#parts.drafts?.read() ?? null;
    if (draft === null) return t("scene-draft-none");
    // The prefab mode of the page keeps a prefab document.
    const kind = this.file.path.endsWith(".prefab.json") ? "prefab" : "scene";
    const read = readDocument(draft.text, kind, { registry: this.registry });
    if (!read.ok) return t("scene-draft-unread", { reason: read.errors[0]?.message ?? "" });
    const reason = this.apply(diffDocuments(this.channel.doc, read.doc), t("scene-history-restore-draft"));
    if (reason === null) this.#parts.bar?.notice(null);
    return reason;
  }

  /** Read the file on the disk: true and a notice when it changed after the load or the last save. */
  async checkDisk(): Promise<boolean> {
    const { files, bar } = this.#parts;
    if (files === undefined || this.#saving) return false;
    const disk = await files.read(this.file.path).catch(() => null);
    const changed = disk === null ? false : disk.hash !== this.file.baseHash;
    if (changed && bar?.noticeKind !== "draft") bar?.notice(this.#conflictNotice(this.#diskDiff(disk?.text ?? null)));
    return changed;
  }

  /** Send scene ops to the runtime after the patches before them. */
  #queue(ops: readonly SceneOp[]): void {
    if (ops.length === 0) return;
    this.#patched = this.#patched.then(() => this.#send(ops));
  }

  async #send(ops: readonly SceneOp[]): Promise<void> {
    const result = await this.#parts.patch(ops);
    if (!result.ok) console.warn(`the runtime refused a scene op: ${result.reason}`);
  }

  /** The conflict dialog with the semantic diff from the scene of the editor to the file on the disk. */
  async #showConflict(): Promise<void> {
    const disk = await this.#parts.files?.read(this.file.path).catch(() => null);
    this.#parts.bar?.notice(this.#conflictNotice(this.#diskDiff(disk?.text ?? null)));
  }

  #diskDiff(text: string | null): DialogDetails | null {
    if (text === null) return null;
    return diskDetails(t("scene-conflict-diff"), text, this.file.path, this.channel.doc, this.registry);
  }

  #conflictNotice(details: DialogDetails | null): BarNotice {
    return {
      kind: "conflict",
      text: t("scene-conflict"),
      ...(details === null ? {} : { details }),
      first: {
        label: t("scene-conflict-reload"),
        testId: "conflict-reload",
        run: () => {
          this.#parts.drafts?.clear();
          (this.#parts.reload ?? (() => location.reload()))();
        },
      },
      second: { label: t("scene-conflict-overwrite"), testId: "conflict-overwrite", run: () => void this.save(true) },
    };
  }
}
