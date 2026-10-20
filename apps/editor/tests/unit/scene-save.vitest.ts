// SPDX-License-Identifier: Apache-2.0
// The save of the scene page. The editor of the page keeps the document with one history and patches the core. The
// file bar shows the dirty state. A save writes the canonical text through the port. A conflict gives the Reload and
// Overwrite notice. The local draft comes back after a reload. The tests also cover the drag math and the save route
// of the dev server. The showroom files are read only: each write goes to a temp copy.
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { answer, noticeShell } from "../support/noticeShell";
import { sceneDraftKey, SceneDrafts, sceneTextHash, type DraftStorage } from "@scenity/editor-core";
import { readSceneFile, saveSceneFile, type SceneRuleVerdict, type SceneSaveParams } from "@scenity/cli/sceneFile";
import { writeDocument, type SceneDocument, type SceneOp } from "@scenity/scene";
import { handleSceneSave, SAVE_HEADER } from "../../scripts/sceneSave";
import { cameraEntity, cameraView, levelHit, localDelta, onLevelGrid, viewRay } from "../../src/scene/dragMath";
import { sceneBar } from "../../src/scene/sceneBar";
import { ScenePageEditor } from "../../src/scene/sceneEditor";
import type { SceneFilePort } from "../../src/scene/sceneFiles";
import { parseScene } from "../../src/scene/project";

const SHOWROOM = join(import.meta.dirname, "../../../../samples/showroom");
const PATH = "scenes/main.scene.json";
const TABLE = "/entities/table/components/transform/position";
const temp = mkdtempSync(join(tmpdir(), "scenity-scene-save-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let copies = 0;
/** A temp copy of the scenes of the showroom. */
function copy(): string {
  copies += 1;
  const dir = join(temp, `showroom-${String(copies)}`);
  cpSync(join(SHOWROOM, "scenes"), join(dir, "scenes"), { recursive: true });
  return dir;
}

/** A pass verdict for each rule of a scene (the page checks the rules before a save). */
function passed(doc: Pick<SceneDocument, "rules">): SceneRuleVerdict[] {
  return (doc.rules ?? []).map((rule) => ({ id: rule.id, level: rule.level, status: "pass" }));
}

/** The save parameters of another tool with the pass verdicts of the rules of its text. */
function passing<P extends { readonly text: string }>(params: P): P & Pick<SceneSaveParams, "checks"> {
  const verdicts = passed(JSON.parse(params.text) as Pick<SceneDocument, "rules">);
  return { ...params, checks: { hash: sceneTextHash(params.text), verdicts } };
}

/** The port of a project folder on the disk (the writer of the host and of the dev server). */
function diskPort(dir: string): SceneFilePort {
  return {
    read: (path) => Promise.resolve(readSceneFile(dir, path)),
    save: (params: SceneSaveParams) => Promise.resolve(saveSceneFile(dir, params)),
  };
}

function memory(): DraftStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** An editor of the page in the edit mode on a project folder; `patches` lists the ops that the core got. */
function pageEditor(
  dir: string,
  storage: DraftStorage,
  reloads: string[] = [],
  checkRules = (doc: SceneDocument) => Promise.resolve(passed(doc)),
) {
  const diskText = readFileSync(join(dir, PATH), "utf8");
  const patches: SceneOp[][] = [];
  const drafts = new SceneDrafts(storage, sceneDraftKey("showroom", PATH), PATH);
  const editor = new ScenePageEditor({
    patch: (ops) => {
      patches.push([...ops]);
      return Promise.resolve({ ok: true, warnings: [] });
    },
    doc: parseScene(diskText),
    path: PATH,
    diskText,
    files: diskPort(dir),
    drafts,
    bar: sceneBar(PATH, () => undefined),
    now: () => 1_000,
    reload: () => reloads.push("reload"),
    checkRules,
  });
  return { editor, patches, drafts };
}

const testId = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);

let notices = noticeShell();

beforeEach(() => {
  document.body.replaceChildren();
  // The notices of the file bar are dialogs of the editor window.
  notices = noticeShell();
});

describe("the save of the scene page", () => {
  it("moves an entity through the scene channel, shows the dirty state and saves the canonical text", async () => {
    const dir = copy();
    const { editor, patches } = pageEditor(dir, memory());
    expect(testId("scene-state")?.textContent).toBe("saved");
    expect(editor.apply([{ op: "set", path: TABLE, value: [1.9, 0, -0.9] }], "Move the table")).toBeNull();
    await editor.settled();
    expect(patches.length).toBe(1);
    expect(testId("scene-bar")?.dataset.dirty).toBe("1");
    expect(document.title).toBe("* Scenity scene");
    const result = await editor.save();
    expect(result).toMatchObject({ ok: true, changed: true });
    const disk = readFileSync(join(dir, PATH), "utf8");
    expect(disk).toBe(writeDocument(editor.doc));
    expect(disk).toContain('"position": [1.9, 0, -0.9]');
    expect(editor.file.baseHash).toBe(sceneTextHash(disk));
    expect(testId("scene-state")?.textContent).toBe("saved");
    // An undo after the save makes the document dirty again.
    editor.channel.undo();
    expect(editor.dirty).toBe(true);
  });

  it("refuses a save over a file that changed on the disk and offers Reload and Overwrite", async () => {
    const dir = copy();
    const reloads: string[] = [];
    const { editor } = pageEditor(dir, memory(), reloads);
    editor.apply([{ op: "set", path: TABLE, value: [0, 0, 0] }], "Move");
    // Another tool writes the file after the load.
    const theirs = saveSceneFile(
      dir,
      passing({
        path: PATH,
        text: readFileSync(join(dir, PATH), "utf8").replace('"position": [1.6, 0, -0.9]', '"position": [2, 0, 2]'),
        baseHash: editor.file.baseHash,
      }),
    );
    expect(theirs.ok).toBe(true);
    expect(await editor.checkDisk()).toBe(true);
    expect(await editor.save()).toMatchObject({ ok: false, conflict: true });
    expect(notices.dialog?.kind).toBe("conflict");
    await answer(notices, "conflict-overwrite");
    await expect.poll(() => readFileSync(join(dir, PATH), "utf8")).toContain('"position": [0, 0, 0]');
    expect(notices.dialog).toBeNull();
    editor.apply([{ op: "set", path: TABLE, value: [1, 0, 1] }], "Move");
    const disk = readFileSync(join(dir, PATH), "utf8").replace('"position": [0, 0, 0]', '"position": [3, 0, 3]');
    saveSceneFile(dir, passing({ path: PATH, text: disk, baseHash: null, force: true }));
    await editor.save();
    await answer(notices, "conflict-reload");
    expect(reloads).toEqual(["reload"]);
  });

  it("a failed block rule stops the save; the notice asks for a reason, and the reason saves", async () => {
    const dir = copy();
    const lantern = "/entities/lantern/components/transform/position";
    // The page check: the lantern is far from the table top after the move.
    const fail = (doc: SceneDocument) =>
      Promise.resolve(
        passed(doc).map((verdict) =>
          verdict.id === "showroom.lanternOnTable"
            ? { ...verdict, status: "fail" as const, detail: "1.2 m (120.0 cm in space), max 0.45 m" }
            : verdict,
        ),
      );
    const { editor } = pageEditor(dir, memory(), [], fail);
    const before = readFileSync(join(dir, PATH), "utf8");
    editor.apply([{ op: "set", path: lantern, value: [1.2, 0.55, 0] }], "Move the lantern");
    const refused = await editor.save();
    expect(refused).toMatchObject({ ok: false, conflict: false, blocked: [{ id: "showroom.lanternOnTable" }] });
    expect(readFileSync(join(dir, PATH), "utf8")).toBe(before);
    expect(notices.dialog?.kind).toBe("rules");
    expect(notices.dialog?.text).toContain("showroom.lanternOnTable: 1.2 m");
    expect(testId("scene-state")?.textContent).toBe("not saved: a rule fails");
    // The save action waits for a reason in the field.
    expect(notices.dialog?.actions.find((action) => action.testId === "rules-save")?.needsText).toBe(true);
    expect(notices.dialog?.input?.testId).toBe("rules-reason");
    await answer(notices, "rules-save", "the lantern goes to the shelf next");
    await expect.poll(() => readFileSync(join(dir, PATH), "utf8")).toContain('"position": [1.2, 0.55, 0]');
    await expect.poll(() => testId("scene-state")?.textContent).toBe("saved");
    expect(notices.dialog).toBeNull();
    const log = readFileSync(join(dir, "scenes/main.rules-log.jsonl"), "utf8");
    expect(JSON.parse(log)).toMatchObject({ reason: "the lantern goes to the shelf next" });
  });

  it("keeps a local draft of a dirty document and offers it after a reload", async () => {
    const dir = copy();
    const storage = memory();
    const first = pageEditor(dir, storage);
    first.editor.apply([{ op: "set", path: TABLE, value: [0.5, 0, 0.5] }], "Move");
    // The page crashes: a new page on the same storage offers the draft.
    document.body.replaceChildren();
    const second = pageEditor(dir, storage);
    second.editor.offerDraft();
    expect(notices.dialog?.kind).toBe("draft");
    await answer(notices, "draft-restore");
    await second.editor.settled();
    expect(writeDocument(second.editor.doc)).toBe(writeDocument(first.editor.doc));
    expect(second.patches.length).toBe(1);
    expect(second.editor.channel.undo()).toBe(true);
    // A save clears the draft; a third page has no offer.
    second.editor.channel.redo();
    await second.editor.save();
    document.body.replaceChildren();
    const third = pageEditor(dir, storage);
    third.editor.offerDraft();
    expect(notices.dialog).toBeNull();
    expect(third.drafts.read()).toBeNull();
  });
});

describe("the drag math of the scene page", () => {
  it("casts the ray of the canvas centre along the view of the camera", () => {
    const doc = parseScene(readFileSync(join(SHOWROOM, PATH), "utf8"));
    expect(cameraEntity(doc, null)).toBe("front");
    expect(cameraEntity(doc, "top")).toBe("top");
    const view = cameraView(doc, "front");
    if (view === null) throw new Error("no view");
    const ray = viewRay(view, 400, 300, 800, 600);
    ray.direction.forEach((value, index) => expect(value).toBeCloseTo(view.forward[index] ?? 0, 6));
    // The centre ray meets the floor; a ray that looks up meets no floor in front.
    expect(levelHit(ray, 0)?.[1]).toBeCloseTo(0, 6);
    expect(levelHit({ origin: [0, 1, 0], direction: [0, 1, 0] }, 0)).toBeNull();
    // A child turns a world move into its parent space; a root entity keeps it.
    expect(localDelta(doc, "table", [0.1, 0, 0])).toEqual([0.1, 0, 0]);
    expect(onLevelGrid([0.1234, 0.549, -0.006], 0.01)).toEqual([0.12, 0.549, -0.01]);
  });
});

describe("the save route of the dev server", () => {
  function post(body: string, headers: Record<string, string>): IncomingMessage {
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
    Object.assign(request, { method: "POST", headers: { host: "127.0.0.1:5176", ...headers } });
    return request;
  }

  function response(): ServerResponse & { status: () => number; body: () => unknown } {
    let status = 0;
    let text = "";
    const fake = {
      set statusCode(value: number) {
        status = value;
      },
      setHeader: () => undefined,
      end: (value: string) => {
        text = value;
      },
      status: () => status,
      body: () => JSON.parse(text) as unknown,
    };
    return fake as unknown as ServerResponse & { status: () => number; body: () => unknown };
  }

  it("saves a POST of a page of the server and refuses another origin or the remote mode", async () => {
    const dir = copy();
    const base = readSceneFile(dir, PATH);
    const params = passing({
      path: PATH,
      text: base.text.replace("1.6, 0, -0.9", "1.7, 0, -0.9"),
      baseHash: base.hash,
    });
    const good = { origin: "http://127.0.0.1:5176", [SAVE_HEADER]: "1" };
    const saved = response();
    await handleSceneSave(post(JSON.stringify(params), good), saved, dir, PATH, {});
    expect(saved.status()).toBe(200);
    expect(readFileSync(join(dir, PATH), "utf8")).toContain("[1.7, 0, -0.9]");
    const conflict = response();
    await handleSceneSave(post(JSON.stringify(params), good), conflict, dir, PATH, {});
    expect(conflict.status()).toBe(409);
    for (const headers of [{ origin: "http://evil.example", [SAVE_HEADER]: "1" }, { origin: good.origin }]) {
      const refused = response();
      await handleSceneSave(post(JSON.stringify(params), headers), refused, dir, PATH, {});
      expect(refused.status()).toBe(403);
    }
    const remote = response();
    const env = { SCENITY_WORKBENCH_PUBLIC_ORIGIN: "https://scenity.example" };
    await handleSceneSave(post(JSON.stringify(params), good), remote, dir, PATH, env);
    expect(remote.status()).toBe(403);
    const other = response();
    await handleSceneSave(
      post(JSON.stringify({ ...params, path: "scenes/crowd.scene.json" }), good),
      other,
      dir,
      PATH,
      {},
    );
    expect(other.status()).toBe(400);
  });
});
