// SPDX-License-Identifier: Apache-2.0
/**
 * The project start screen of the scene page: `?project=<id>&edit=1` with no `scene=` parameter. It shows the name of
 * the project, its scenes with their pictures (the poster, else a still), the recent scenes of the project (browser
 * storage), New scene and Open a path. A scene opens in the edit mode of the page (`scene=<path>`). The texts are
 * Fluent messages of `src/i18n/en-US/projects.ftl`; the names and the paths of the project and its scenes are data
 * values. DOM nodes only (no HTML text).
 *
 * `data-ready="1"` on the screen shows that the list is ready. `globalThis.__scenityStart` gives the project, the
 * scenes and the recent scenes to the tests.
 */
import { newScenePlan, RecentScenes, type DraftStorage } from "@scenity/editor-core";
import { devServerFiles, type ProjectSceneFile, type ProjectScenes } from "../sceneFiles";
import { projectPageUrl } from "./pageScenes";
import "./projects.css";
import { pageSettings } from "../settings/pageSettings";
import { t } from "../../texts";

/** What the start screen gives the tests. */
export interface StartScreenInfo {
  readonly project: { readonly id: string; readonly name: string };
  readonly scenes: readonly ProjectSceneFile[];
  readonly recent: readonly string[];
}

function pageStorage(): DraftStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", testId?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  item.textContent = text;
  if (testId !== undefined) item.dataset.testid = testId;
  return item;
}

/** A node of a data value (a name or a path): `translate="no"`. */
function data<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, testId?: string): HTMLElementTagNameMap[K] {
  const item = node(tag, text, testId);
  item.setAttribute("translate", "no");
  return item;
}

/** The link of a scene of the project; `text` is a path (a data value) or empty. */
function sceneLink(path: string, text: string): HTMLAnchorElement {
  const link = text === "" ? node("a") : data("a", text);
  link.href = projectPageUrl(location.href, path);
  link.dataset.path = path;
  return link;
}

/** The card of a scene: its picture (or an empty frame), its name and its path. */
function sceneCard(base: string, file: ProjectSceneFile): HTMLElement {
  const card = node("li", "", "start-scene");
  card.dataset.path = file.path;
  const link = sceneLink(file.path, "");
  const frame = node("span");
  frame.className = "start-picture";
  if (file.picture !== null) {
    const image = document.createElement("img");
    image.src = `${base}${file.picture}`;
    image.alt = "";
    image.loading = "lazy";
    frame.append(image);
  } else frame.textContent = t("projects-no-picture");
  const name = data("strong", file.name ?? file.id ?? file.path);
  const path = file.listed ? data("span", file.path) : node("span", t("projects-unlisted", { path: file.path }));
  path.className = "start-path";
  link.append(frame, name, path);
  card.append(link);
  return card;
}

/** A form with one text field and one button; `run` gives the reason of a refusal, or null. */
function textForm(
  label: string,
  placeholder: string,
  testId: string,
  run: (value: string) => Promise<string | null>,
): HTMLFormElement {
  const form = node("form", "", testId);
  const field = node("input");
  field.type = "text";
  field.placeholder = placeholder;
  field.setAttribute("aria-label", placeholder);
  field.maxLength = 200;
  const button = node("button", label);
  button.type = "submit";
  const status = node("span", "", `${testId}-status`);
  form.append(field, button, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = field.value.trim();
    if (value === "") return;
    button.disabled = true;
    void run(value).then((reason) => {
      button.disabled = false;
      status.textContent = reason ?? "";
    });
  });
  return form;
}

/** Show the start screen of the project `project` (a page name of the dev server). */
export async function startScreen(project: string): Promise<void> {
  const base = `/projects/${project}/`;
  const files = devServerFiles(base);
  const canvas = document.querySelector<HTMLCanvasElement>("#scene");
  canvas?.setAttribute("hidden", "");
  const screen = node("main", "", "scene-start");
  screen.id = "scene-start";
  document.body.append(screen);
  document.title = t("projects-start-title");
  let list: ProjectScenes;
  try {
    list = await files.list();
  } catch (error) {
    screen.append(node("p", t("projects-no-list", { project, reason: String(error) }), "start-error"));
    return;
  }
  // The count of recent scenes is an editor setting (of the user: the browser storage).
  const recent = new RecentScenes(pageStorage(), project, () => pageSettings().value.recent.count);
  const paths = new Set(list.files.map((file) => file.path));
  const recentPaths = recent.list().filter((path) => paths.has(path));
  // The scenes of the project file first, in its order; then the other scene files of the folder.
  const order = (file: ProjectSceneFile): number => (file.listed ? list.scenes.indexOf(file.path) : list.scenes.length);
  const scenes = [...list.files].sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path));
  const open = (path: string): void => location.assign(projectPageUrl(location.href, path));
  const grid = node("ul", "", "start-scenes");
  grid.append(...scenes.map((file) => sceneCard(base, file)));
  const recentList = node("ul", "", "start-recent");
  for (const path of recentPaths) {
    const item = node("li");
    item.append(sceneLink(path, path));
    recentList.append(item);
  }
  const create = textForm(t("projects-start-new"), t("projects-new-name"), "start-new", async (name) => {
    const plan = newScenePlan(name, paths);
    const result = await files.create({ path: plan.path, sceneId: plan.id, name: plan.name });
    if (!result.ok) return result.reason;
    open(result.path);
    return null;
  });
  const byPath = textForm(t("projects-open"), t("projects-path-example"), "start-open", (path) => {
    open(path);
    return Promise.resolve(null);
  });
  screen.append(
    data("h1", list.name, "start-project"),
    node("p", t("projects-start-id", { id: list.id })),
    node("h2", t("projects-start-scenes")),
    scenes.length === 0 ? node("p", t("projects-start-empty")) : grid,
    node("h2", t("projects-start-recent")),
    recentPaths.length === 0 ? node("p", t("projects-start-recent-none"), "start-recent-none") : recentList,
    node("h2", t("projects-start-new")),
    create,
    node("h2", t("projects-start-path")),
    byPath,
  );
  const info: StartScreenInfo = { project: { id: list.id, name: list.name }, scenes, recent: recentPaths };
  globalThis.__scenityStart = info;
  screen.dataset.ready = "1";
}

declare global {
  var __scenityStart: StartScreenInfo | undefined;
}

/**
 * The start screen of a page URL: `?project=<id>&edit=1` with no `scene=` parameter gives the start screen of the
 * project; any other URL gives null (the page opens its scene).
 */
export function startPage(search: string): Promise<void> | null {
  const params = new URLSearchParams(search);
  if (params.get("edit") !== "1" || params.has("scene")) return null;
  const project = params.get("project") ?? "showroom";
  if (!/^[a-z0-9-]+$/.test(project)) return Promise.reject(new Error(t("scene-error-project", { project })));
  return startScreen(project);
}
