// SPDX-License-Identifier: Apache-2.0
// The scenes of a project on the scene page. The page editor opens a second scene of the project. Each scene keeps its
// own undo history over a switch. The file bar and the drafts follow the active scene. A save as moves the scene to a
// new path. A close with unsaved changes asks first. New writes an empty scene that the project file lists. The dev
// server gives the scene list and refuses a create from another origin.
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { answer, noticeShell } from "../support/noticeShell";
import { sceneDraftKey, SceneDrafts, type DraftStorage } from "@scenity/editor-core";
import { createSceneFile, readSceneFile, saveSceneFile } from "@scenity/cli/sceneFile";
import type { SceneDocument, SceneOp } from "@scenity/scene";
import type { SceneRuleVerdict } from "@scenity/cli/sceneFileContract";
import { handleSceneCreate, projectScenes } from "../../scripts/sceneProject";
import { projectFiles } from "../../scripts/projects";
import { SAVE_HEADER } from "../../scripts/sceneSave";
import { PageScenes, projectPageUrl } from "../../src/scene/projects/pageScenes";
import { parseScene } from "../../src/scene/project";
import { sceneBar } from "../../src/scene/sceneBar";
import { ScenePageEditor } from "../../src/scene/sceneEditor";
import type { SceneFilePort } from "../../src/scene/sceneFiles";

const SHOWROOM = join(import.meta.dirname, "../../../../samples/showroom");
const MAIN = "scenes/main.scene.json";
const EFFECTS = "scenes/effects.scene.json";
const TABLE = "/entities/table/components/transform/position";
const temp = mkdtempSync(join(tmpdir(), "scenity-scene-projects-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let copies = 0;
/** A temp copy of the project file and the scenes of the showroom. */
function copy(): string {
  copies += 1;
  const dir = join(temp, `showroom-${String(copies)}`);
  cpSync(join(SHOWROOM, "scenes"), join(dir, "scenes"), { recursive: true });
  cpSync(join(SHOWROOM, "scenity.project.json"), join(dir, "scenity.project.json"));
  return dir;
}

/** The port of a project folder on the disk, as the dev server and the host have it. */
function diskPort(dir: string): SceneFilePort {
  return {
    read: (path) => Promise.resolve(readSceneFile(dir, path)),
    save: (params) => Promise.resolve(saveSceneFile(dir, params)),
    create: (params) => Promise.resolve(createSceneFile(dir, params)),
    list: () => Promise.resolve(projectScenes(dir, "showroom", projectFiles(dir))),
  };
}

/** A pass verdict for each rule of the scene and of the project file (the page checks the rules before a save). */
function passing(dir: string, doc: SceneDocument): SceneRuleVerdict[] {
  const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as {
    rules?: { id: string; level: "block" | "warn" }[];
  };
  const rules = [...(doc.rules ?? []), ...(project.rules ?? [])];
  return rules.map((rule) => ({ id: rule.id, level: rule.level, status: "pass" }));
}

function memory(): DraftStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** A page editor in the edit mode with its open scenes; the rules of the copy pass (no rule results are needed). */
function page(dir: string) {
  const storage = memory();
  const diskText = readFileSync(join(dir, MAIN), "utf8");
  const patches: SceneOp[][] = [];
  const drafts = new SceneDrafts(storage, sceneDraftKey("showroom", MAIN), MAIN);
  const bar = sceneBar(MAIN, () => undefined);
  const files = diskPort(dir);
  const editor = new ScenePageEditor({
    patch: (ops) => {
      patches.push([...ops]);
      return Promise.resolve({ ok: true, warnings: [] });
    },
    ...{ doc: parseScene(diskText), path: MAIN, diskText, files, drafts, bar },
    checkRules: (doc) => Promise.resolve(passing(dir, doc)),
  });
  const navigations: string[] = [];
  const ids: { list: readonly string[] } = { list: [] };
  const selection = {
    get ids() {
      return ids.list;
    },
    set: (next: readonly string[]) => void (ids.list = next),
    listen: () => () => undefined,
  };
  const scenes = new PageScenes({
    ...{ editor, project: "showroom", files, drafts, storage, bar, selection },
    camera: () => null,
    checkRules: (doc) => Promise.resolve(passing(dir, doc)),
    navigate: (url) => navigations.push(url),
  });
  return { editor, scenes, storage, patches, navigations, selection };
}

function tableX(editor: ScenePageEditor): number | undefined {
  const transform = editor.doc.entities.table?.components.transform as { position?: number[] } | undefined;
  return transform?.position?.[0];
}

const testId = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);

let notices = noticeShell();

beforeEach(() => {
  document.body.replaceChildren();
  // The notices of the file bar are dialogs of the editor window.
  notices = noticeShell();
});

describe("the scenes of a project on the scene page", () => {
  it("opens a second scene, keeps each undo history, and moves the file bar and the drafts", async () => {
    const dir = copy();
    const { editor, scenes, storage, selection } = page(dir);
    expect(editor.apply([{ op: "set", path: TABLE, value: [1.5, 0, 0] }], "Move the table")).toBeNull();
    selection.set(["table"]);
    expect(await scenes.open(EFFECTS)).toBeNull();
    expect(editor.file.path).toBe(EFFECTS);
    expect(testId("scene-file")?.textContent).toBe(EFFECTS);
    expect(editor.doc.id).toBe("effects");
    expect(editor.dirty).toBe(false);
    expect(storage.items.has(sceneDraftKey("showroom", MAIN))).toBe(true);
    // The selection of main does not apply to the second scene.
    expect(selection.ids).toEqual([]);
    expect(editor.channel.undo()).toBe(false);
    expect(scenes.list().map((item) => [item.path, item.active, item.dirty])).toEqual([
      [MAIN, false, true],
      [EFFECTS, true, false],
    ]);
    expect(scenes.switchTo(MAIN)).toBeNull();
    expect(tableX(editor)).toBe(1.5);
    expect(selection.ids).toEqual(["table"]);
    expect(editor.channel.undo()).toBe(true);
    expect(editor.dirty).toBe(false);
    await editor.settled();
  });

  it("saves as a new path: the session moves, the old file stays, a second save as over a file refuses", async () => {
    const dir = copy();
    const { editor, scenes } = page(dir);
    const before = readFileSync(join(dir, MAIN), "utf8");
    editor.apply([{ op: "set", path: TABLE, value: [2, 0, 0] }], "Move the table");
    const copyPath = "scenes/main-copy.scene.json";
    const saved = await scenes.saveAs(copyPath);
    expect(saved).toMatchObject({ ok: true, path: copyPath });
    expect(editor.file.path).toBe(copyPath);
    expect(editor.dirty).toBe(false);
    expect(readFileSync(join(dir, MAIN), "utf8")).toBe(before);
    expect(readFileSync(join(dir, copyPath), "utf8")).toContain('"position": [2, 0, 0]');
    expect(scenes.recent.list()[0]).toBe(copyPath);
    // The history stays after the move.
    expect(editor.channel.undo()).toBe(true);
    expect(editor.dirty).toBe(true);
    const over = await scenes.saveAs(EFFECTS);
    expect(over).toMatchObject({ ok: false, conflict: true });
    expect(notices.dialog?.text).toContain("already");
  });

  it("asks at a close with unsaved changes, and shows the start screen after the last close", async () => {
    const dir = copy();
    const { editor, scenes, navigations } = page(dir);
    expect(await scenes.open(EFFECTS)).toBeNull();
    editor.apply([{ op: "set", path: "/name", value: "Effects 2" }], "Rename");
    const asked = scenes.close();
    await Promise.resolve();
    expect(notices.dialog?.spec).toBe("confirm.closeUnsaved");
    await answer(notices, "close-cancel");
    expect(await asked).toMatchObject({ closed: false, active: EFFECTS });
    expect(await scenes.close(undefined, "discard")).toEqual({ closed: true, active: MAIN });
    expect(editor.file.path).toBe(MAIN);
    expect(await scenes.close()).toEqual({ closed: true, active: null });
    expect(navigations).toHaveLength(1);
    expect(navigations[0]).not.toContain("scene=");
  });

  it("creates a new empty scene, lists it in the project file and opens it", async () => {
    const dir = copy();
    const { editor, scenes } = page(dir);
    const created = await scenes.create("Night garden");
    expect(created).toEqual({ ok: true, path: "scenes/night-garden.scene.json" });
    expect(editor.file.path).toBe("scenes/night-garden.scene.json");
    expect(editor.doc).toMatchObject({ id: "night-garden", name: "Night garden", entities: {} });
    const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as { scenes: string[] };
    expect(project.scenes).toEqual([MAIN, "scenes/night-garden.scene.json"]);
    const list = projectScenes(dir, "showroom", projectFiles(dir));
    expect(list.files.find((file) => file.path === "scenes/night-garden.scene.json")).toMatchObject({ listed: true });
    expect(list.files.find((file) => file.path === MAIN)).toMatchObject({ picture: null, listed: true });
    // A second scene with the same name gets a free path.
    expect(await scenes.create("Night garden")).toEqual({ ok: true, path: "scenes/night-garden-2.scene.json" });
  });

  it("gives the URL of a scene and of the start screen", () => {
    const href = "http://127.0.0.1:5176/scene.html?project=showroom&scene=scenes/a.scene.json&sel=x&backend=webgpu";
    expect(projectPageUrl(href, "scenes/b.scene.json")).toBe(
      "/scene.html?project=showroom&backend=webgpu&edit=1&scene=scenes%2Fb.scene.json",
    );
    expect(projectPageUrl(href, null)).toBe("/scene.html?project=showroom&backend=webgpu&edit=1");
  });
});

/** A fake request of the dev server with a JSON body. */
function request(body: unknown, headers: Record<string, string>): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  stream.headers = headers;
  return stream;
}

function response(): ServerResponse & { status: number; body: string } {
  const out = {
    status: 0,
    body: "",
    set statusCode(value: number) {
      out.status = value;
    },
    setHeader: () => undefined,
    end: (text: string) => void (out.body = text),
  };
  return out as unknown as ServerResponse & { status: number; body: string };
}

describe("the create route of the dev server", () => {
  it("creates from a page of the server and refuses another origin and the remote mode", async () => {
    const dir = copy();
    const params = { path: "scenes/new.scene.json", sceneId: "new", name: "New" };
    const same = { host: "127.0.0.1:5176", origin: "http://127.0.0.1:5176", [SAVE_HEADER]: "1" };
    const other = response();
    await handleSceneCreate(request(params, { ...same, origin: "http://evil.test" }), other, dir, {});
    expect(other.status).toBe(403);
    const remote = response();
    await handleSceneCreate(request(params, same), remote, dir, { SCENITY_WORKBENCH_PUBLIC_ORIGIN: "https://x.test" });
    expect(remote.status).toBe(403);
    const made = response();
    await handleSceneCreate(request(params, same), made, dir, {});
    expect(made.status).toBe(200);
    expect(JSON.parse(made.body)).toMatchObject({ ok: true, path: "scenes/new.scene.json", listed: true });
    const hidden = response();
    await handleSceneCreate(request({ ...params, path: "scenes/.new.scene.json" }, same), hidden, dir, {});
    expect(hidden.status).toBe(400);
  });
});

describe("the rule gate of a save as", () => {
  it("refuses a save as while a block rule fails, and saves it with a reason", async () => {
    const dir = copy();
    const { editor, storage } = page(dir);
    document.body.replaceChildren();
    const bar = sceneBar(MAIN, () => undefined);
    const drafts = new SceneDrafts(storage, sceneDraftKey("showroom", MAIN), MAIN);
    const failing = (doc: SceneDocument): Promise<SceneRuleVerdict[]> =>
      Promise.resolve(
        passing(dir, doc).map((verdict) =>
          verdict.id === "showroom.onFloor" ? { ...verdict, status: "fail", detail: "below the floor" } : verdict,
        ),
      );
    const scenes = new PageScenes({
      ...{ editor, project: "showroom", files: diskPort(dir), drafts, storage, bar },
      camera: () => null,
      checkRules: failing,
    });
    const path = "scenes/blocked.scene.json";
    const refused = await scenes.saveAs(path);
    expect(refused).toMatchObject({ ok: false, conflict: false, blocked: [{ id: "showroom.onFloor" }] });
    expect(notices.dialog?.input?.testId).toBe("rules-reason");
    expect(editor.file.path).toBe(MAIN);
    const saved = await scenes.saveAs(path, "a test of the gate");
    expect(saved).toMatchObject({ ok: true, path, override: "a test of the gate" });
    expect(editor.file.path).toBe(path);
  });
});
