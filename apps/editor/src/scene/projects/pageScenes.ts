// SPDX-License-Identifier: Apache-2.0
/**
 * The open scenes of the scene page in the edit mode: new, open, save as, close and the switch between the scenes of
 * one project, over the document sessions of `@scenity/editor-core`.
 *
 * - The page has one editor (sceneEditor.ts): its scene channel, its file state and its drafts. The active scene is
 *   in them. The page parks each other open scene with its own history (`DocumentSessions`). A switch restores the
 *   document, the view state, the sequence and the undo steps of the other scene. The runtime gets the change as a
 *   patch. The page keeps the selection and the camera of each scene, and the URL names the active scene.
 * - New writes an empty scene through the port (`scene.create`, scripts/sceneProject.ts), then opens it.
 * - Save as writes the scene to a new path with no base hash, with the rule results of the page (the rule gate of the
 *   writer). Then the session moves to the new path, with its history.
 * - Close asks about unsaved changes (Save and close, Close without saving, Cancel). After the last close the page
 *   shows the project start screen.
 * - Each open or switch puts the scene at the top of the recent scenes of the project (browser storage).
 *
 * The texts are Fluent messages of `src/i18n/en-US/projects.ftl`. A refusal reason of `@scenity/editor-core`
 * or of the writer stays as it is.
 */
import {
  DocumentSessions,
  draftOffer,
  EditError,
  newScenePlan,
  RecentScenes,
  sceneDraftKey,
  SceneDrafts,
  sceneTextHash,
  type CloseChoice,
  type DocumentSession,
  type DraftStorage,
  type SceneDraft,
} from "@scenity/editor-core";
import { readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { savedFileKind, sceneFilePathProblem, type SceneRuleVerdict } from "@scenity/cli/sceneFileContract";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { BarNotice, SceneBar } from "../sceneBar";
import type { PageSaveResult, ScenePageEditor } from "../sceneEditor";
import type { ProjectScenes, SceneFilePort } from "../sceneFiles";
import { pageSettings } from "../settings/pageSettings";
import { t } from "../../texts";

/** The parts of the page that the open scenes use. */
export interface PageScenesParts {
  readonly editor: ScenePageEditor;
  readonly project: string;
  readonly files: SceneFilePort;
  readonly drafts: SceneDrafts;
  readonly storage: DraftStorage | null;
  readonly bar: SceneBar;
  readonly selection?: PageSelectionPort | undefined;
  /** The document camera of the page (null: the first camera), and a switch of it. */
  readonly camera: () => string | null;
  readonly openCamera?: ((name: string | null) => Promise<boolean>) | undefined;
  /** The verdicts of the rules on a scene document (pageRules.ts), for the save as. */
  readonly checkRules?: ((doc: SceneDocument) => Promise<readonly SceneRuleVerdict[]>) | undefined;
  /** Go to another page (the start screen after the last close). Default: `location.assign`. */
  readonly navigate?: (url: string) => void;
}

/** One open scene in the list of the page. */
export interface OpenSceneInfo {
  readonly path: string;
  readonly active: boolean;
  readonly dirty: boolean;
  readonly canUndo: boolean;
}

/** The result of a New scene: the path of the new scene, or the reason of a refusal. */
export type NewSceneResult =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string };

/** The result of a close. */
export interface CloseSceneResult {
  readonly closed: boolean;
  readonly reason?: string;
  /** The path of the active scene after the close, or null (the page shows the start screen). */
  readonly active: string | null;
}

/** The URL of a page of the project: the scene page of `scene`, or the start screen with null. */
export function projectPageUrl(href: string, scene: string | null): string {
  const url = new URL(href);
  for (const name of ["scene", "sel", "camera"]) url.searchParams.delete(name);
  url.searchParams.set("edit", "1");
  if (scene !== null) url.searchParams.set("scene", scene);
  return `${url.pathname}${url.search}`;
}

/** Why a path cannot be the path of a scene of the project, or null. */
function scenePathProblem(path: string): string | null {
  const problem = sceneFilePathProblem(path);
  if (problem !== null) return problem;
  return savedFileKind(path) === "scene" ? null : t("projects-path-suffix");
}

const pageScenes = new WeakMap<ScenePageEditor, PageScenes>();

/** The open scenes of an editor in the edit mode, or undefined. */
export function scenesOf(editor: ScenePageEditor): PageScenes | undefined {
  return pageScenes.get(editor);
}

export class PageScenes {
  readonly sessions: DocumentSessions;
  readonly recent: RecentScenes;
  readonly #parts: PageScenesParts;
  readonly #listeners = new Set<() => void>();
  /** The draft of the scene of a switch, read before the switch keeps the draft state of the new scene. */
  #pending: SceneDraft | null = null;

  constructor(parts: PageScenesParts) {
    this.#parts = parts;
    const { editor, project } = parts;
    // The count of recent scenes is an editor setting.
    this.recent = new RecentScenes(parts.storage, project, () => pageSettings().value.recent.count);
    this.sessions = new DocumentSessions({
      channel: editor.channel,
      file: editor.file,
      drafts: parts.drafts,
      draftKey: (path) => sceneDraftKey(project, path),
      busy: () => (editor.play.active ? t("projects-stop-play") : null),
    });
    this.sessions.beforeSwitch((from, to) => {
      this.#park(from);
      this.#pending = new SceneDrafts(parts.storage, to.draftKey, to.path).read();
    });
    this.sessions.afterSwitch((_, to) => {
      this.#arrive(to);
    });
    pageScenes.set(editor, this);
    this.recent.touch(editor.file.path);
  }

  /** The open scenes in the order of their open. */
  list(): OpenSceneInfo[] {
    const { editor } = this.#parts;
    return this.sessions.list().map((session) => ({
      path: session.path,
      active: session.active,
      dirty: session.active ? editor.dirty : session.dirty,
      canUndo: this.sessions.canUndo(session),
    }));
  }

  /** The scene list of the project, or null when the port has none or the list fails. */
  async projectScenes(): Promise<ProjectScenes | null> {
    return (await this.#parts.files.list?.().catch(() => null)) ?? null;
  }

  /** Call `listener` after each open, switch, save as and close; the result stops it. */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Open a scene of the project (or switch to it when it is open); the reason of a refusal, or null. */
  async open(path: string): Promise<string | null> {
    const found = this.sessions.find(path);
    if (found !== null) return this.#activate(found);
    const problem = scenePathProblem(path) ?? this.sessions.busy();
    if (problem !== null) return problem;
    let text: string;
    try {
      text = (await this.#parts.files.read(path)).text;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    const read = readDocument(text, "scene", { registry: this.#parts.editor.registry });
    if (!read.ok) return t("projects-unread", { reason: read.errors[0]?.message ?? "" });
    // A second open of the same path can end first: then the switch goes to that session.
    const session = this.sessions.find(path) ?? this.sessions.open({ path, doc: read.doc, diskText: text });
    return this.#activate(session);
  }

  /** Write a new empty scene with the name `name` and open it. */
  async create(name: string): Promise<NewSceneResult> {
    const create = this.#parts.files.create?.bind(this.#parts.files);
    if (create === undefined) return { ok: false, reason: t("projects-no-create") };
    const busy = this.sessions.busy();
    if (busy !== null) return { ok: false, reason: busy };
    const known = (await this.projectScenes())?.files.map((file) => file.path) ?? [];
    const plan = newScenePlan(name, [...known, ...this.sessions.list().map((session) => session.path)]);
    const result = await create({ path: plan.path, sceneId: plan.id, name: plan.name });
    if (!result.ok) return { ok: false, reason: result.reason };
    const read = readDocument(result.text, "scene", { registry: this.#parts.editor.registry });
    if (!read.ok) return { ok: false, reason: t("projects-new-unread") };
    const reason = this.#activate(this.sessions.open({ path: result.path, doc: read.doc, diskText: result.text }));
    return reason === null ? { ok: true, path: result.path } : { ok: false, reason };
  }

  /**
   * Save the active scene to a new path: a new file, the rule results of the page and the gate of the writer. The
   * session then moves to the new path with its history. With a `reason`, the save continues while a block rule
   * fails.
   */
  async saveAs(path: string, reason?: string): Promise<PageSaveResult> {
    const { editor, files, bar } = this.#parts;
    const session = this.sessions.active;
    const refuse = (words: string): PageSaveResult => ({ ok: false, conflict: false, reason: words });
    if (session === null) return refuse(t("projects-none-open"));
    const problem = scenePathProblem(path) ?? this.sessions.saveAsProblem(session, path) ?? this.sessions.busy();
    if (problem !== null) return refuse(problem);
    const request = session.saveAsRequest(path);
    await editor.settled();
    const verdicts = await this.#parts.checkRules?.(editor.doc);
    const why = reason?.trim() ?? "";
    let result: PageSaveResult;
    try {
      result = await files.save({
        ...request,
        ...(verdicts === undefined ? {} : { checks: { hash: sceneTextHash(request.text), verdicts } }),
        ...(why === "" ? {} : { reason: why }),
      });
    } catch (error) {
      result = refuse(error instanceof Error ? error.message : String(error));
    }
    if (result.ok) this.#moved(session, result.path, result.text, result.hash);
    else if (result.conflict) bar.notice(this.#existsNotice(path));
    else if ("blocked" in result) bar.notice(this.#rulesNotice(path, result.reason));
    else bar.notice(this.#errorNotice(t("projects-not-saved-as", { path, reason: result.reason })));
    return result;
  }

  /**
   * Close an open scene (default: the active scene). With unsaved changes the page asks first, unless `choice` gives
   * the answer. After the last close the page shows the project start screen.
   */
  async close(path?: string, choice?: CloseChoice): Promise<CloseSceneResult> {
    const { editor, storage } = this.#parts;
    const session = path === undefined ? this.sessions.active : this.sessions.find(path);
    if (session === null) return { closed: false, reason: t("projects-not-open"), active: this.#activePath() };
    const key = session.draftKey;
    const closedPath = session.path;
    const asked: { choice: CloseChoice | null } = { choice: null };
    const result = await this.sessions.close(session, {
      dirty: (item) => (item.active ? editor.dirty : item.dirty),
      ask: async (item) => (asked.choice = choice ?? (await this.#ask(item))),
      save: async () => (await editor.save()).ok,
    });
    if (!result.closed)
      return {
        closed: false,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        active: this.#activePath(),
      };
    if (asked.choice === "discard") new SceneDrafts(storage, key, closedPath).clear();
    if (result.active === null) {
      (this.#parts.navigate ?? ((url: string) => location.assign(url)))(projectPageUrl(location.href, null));
    } else this.#tell();
    return { closed: true, active: this.#activePath() };
  }

  /** Switch to an open scene; the reason of a refusal, or null. */
  switchTo(path: string): string | null {
    const session = this.sessions.find(path);
    return session === null ? t("projects-not-open") : this.#activate(session);
  }

  #activePath(): string | null {
    return this.sessions.active?.path ?? null;
  }

  #activate(session: DocumentSession): string | null {
    try {
      this.sessions.activate(session);
    } catch (error) {
      if (error instanceof EditError) return error.message;
      throw error;
    }
    return null;
  }

  /** Before a switch: keep the selection and the camera of the scene that becomes inactive. */
  #park(from: DocumentSession | null): void {
    if (from === null) return;
    from.selection = this.#parts.selection?.ids ?? [];
    from.state = { camera: this.#parts.camera() };
  }

  /** After a switch: the file bar, the draft offer, the selection, the camera, the URL and the recent scenes. */
  #arrive(to: DocumentSession): void {
    const { editor, storage, bar } = this.#parts;
    bar.notice(null);
    editor.changed();
    const pending = this.#pending;
    this.#pending = null;
    if (pending !== null && draftOffer(pending, editor.file) !== null) {
      try {
        storage?.setItem(to.draftKey, JSON.stringify(pending));
      } catch {
        // A blocked storage keeps no draft to offer.
      }
      editor.offerDraft();
    }
    this.#parts.selection?.set(to.selection.filter((id) => Object.hasOwn(editor.doc.entities, id)));
    const camera = to.state.camera;
    void this.#parts.openCamera?.(typeof camera === "string" ? camera : null);
    this.#shown(to.path);
  }

  /** After a save as: the session, the drafts, the recent scenes and the URL take the new path. */
  #moved(session: DocumentSession, path: string, text: string, hash: string): void {
    const { editor, drafts, bar } = this.#parts;
    const old = session.path;
    drafts.clear();
    session.moveTo(path, text, hash);
    drafts.moveTo(session.draftKey, path);
    this.recent.rename(old, path);
    bar.notice(null);
    editor.changed();
    this.#shown(path);
  }

  /** The path of the active scene in the file bar, the URL and the recent scenes. */
  #shown(path: string): void {
    this.#parts.bar.path?.(path);
    this.recent.touch(path);
    try {
      history.replaceState(history.state, "", projectPageUrl(location.href, path));
    } catch {
      // A page with no history (a test) keeps its URL.
    }
    this.#tell();
  }

  #tell(): void {
    for (const listener of this.#listeners) listener();
  }

  /** The question of a close with unsaved changes. */
  #ask(session: DocumentSession): Promise<CloseChoice> {
    const { bar } = this.#parts;
    return new Promise((resolve) => {
      const answer = (choice: CloseChoice) => () => {
        bar.notice(null);
        resolve(choice);
      };
      bar.notice({
        kind: "scene",
        spec: "confirm.closeUnsaved",
        title: t("projects-close-title"),
        text: t("projects-close-ask", { path: session.path }),
        first: { label: t("projects-close-save"), testId: "close-save", run: answer("save") },
        second: { label: t("projects-close-discard"), testId: "close-discard", run: answer("discard") },
        third: { label: t("projects-cancel"), testId: "close-cancel", run: answer("cancel") },
      });
    });
  }

  /** A save as that a failed rule stops: a reason field and "Save as with the reason". */
  #rulesNotice(path: string, words: string): BarNotice {
    return {
      kind: "rules",
      text: t("projects-rules-notice", { path, reason: words }),
      input: { placeholder: t("scene-rules-reason"), testId: "rules-reason" },
      first: { label: t("projects-rules-save"), testId: "rules-save", run: (text) => void this.saveAs(path, text) },
      second: { label: t("projects-cancel"), testId: "rules-cancel", run: () => this.#parts.bar.notice(null) },
    };
  }

  /** A save as to a file that is there already: the owner chooses another path. */
  #existsNotice(path: string): BarNotice {
    return this.#errorNotice(t("projects-exists", { path }));
  }

  #errorNotice(text: string): BarNotice {
    const hide = (): void => this.#parts.bar.notice(null);
    return {
      kind: "scene",
      text,
      first: { label: t("projects-ok"), testId: "scene-notice-ok", run: hide },
      second: { label: t("projects-cancel"), testId: "scene-notice-cancel", run: hide },
    };
  }
}
