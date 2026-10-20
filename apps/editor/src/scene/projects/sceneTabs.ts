// SPDX-License-Identifier: Apache-2.0
/**
 * The scene tabs of the editor window: the open scenes as tabs in the file bar, above the centre group. A tab shows the
 * name of its scene and a mark for unsaved changes. A click on a tab makes its scene active. × closes the scene (with
 * the question about unsaved changes), and the arrow keys move between the tabs. + asks for the name of a new scene,
 * and ⋯ has Open a path, Save as and the Scenes panel. A file name is a data value. DOM nodes only, as the file bar.
 */
import { t } from "../../texts";
import type { SceneBar } from "../sceneBar";
import type { ScenePageEditor } from "../sceneEditor";
import type { OpenSceneInfo, PageScenes } from "./pageScenes";
import { pageKeys } from "../settings/pageKeys";
import { runChoice } from "./sceneActions";

/** The name of a scene file: the last part of its path with no suffix. */
export function sceneName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.scene\.json$/, "");
}

function button(text: string, testid: string, title: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  node.title = title;
  node.dataset.testid = testid;
  return node;
}

/** One tab of an open scene. */
function sceneTab(item: OpenSceneInfo): HTMLElement {
  const tab = document.createElement("span");
  tab.className = "scene-tab";
  tab.dataset.testid = "scene-tab";
  tab.dataset.path = item.path;
  tab.toggleAttribute("data-active", item.active);
  tab.toggleAttribute("data-dirty", item.dirty);
  const name = button(sceneName(item.path), "scene-tab-name", item.path);
  name.setAttribute("role", "tab");
  name.setAttribute("aria-selected", String(item.active));
  name.setAttribute("translate", "no");
  name.tabIndex = item.active ? 0 : -1;
  if (item.dirty) name.setAttribute("aria-description", t("projects-tab-unsaved"));
  name.dataset.command = "scene.open";
  name.addEventListener("click", () => void pageKeys().execute("scene.open", { path: item.path }));
  const mark = document.createElement("span");
  mark.className = "scene-tab-dirty";
  mark.textContent = item.dirty ? "●" : "";
  mark.setAttribute("aria-hidden", "true");
  const close = button("×", "scene-tab-close", t("projects-tab-close", { name: sceneName(item.path) }));
  // A tab list holds only tabs: the × is for the pointer, and Delete on the tab closes the scene for the keyboard.
  close.tabIndex = -1;
  close.setAttribute("aria-hidden", "true");
  close.dataset.command = "scene.close";
  const shut = (): void => void pageKeys().execute("scene.close", { path: item.path });
  close.addEventListener("click", shut);
  name.setAttribute("aria-keyshortcuts", "Delete");
  name.addEventListener("keydown", (event) => {
    if (event.key !== "Delete") return;
    event.preventDefault();
    shut();
  });
  tab.addEventListener("auxclick", (event) => {
    if (event.button === 1) shut();
  });
  tab.append(name, mark, close);
  return tab;
}

/** The menu of ⋯: Open a path, Save as and the Scenes panel. */
function moreMenu(scenes: PageScenes, editor: ScenePageEditor, bar: SceneBar, panel: () => void): HTMLElement {
  const holder = document.createElement("span");
  holder.className = "scene-tabs-more";
  const more = button("⋯", "scene-tabs-more", t("projects-tabs-more"));
  more.setAttribute("aria-haspopup", "menu");
  const menu = document.createElement("span");
  menu.className = "scene-tabs-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const entry = (text: string, value: string, run: () => void): HTMLButtonElement => {
    const node = button(text, `scene-tabs-${value}`, text);
    node.setAttribute("role", "menuitem");
    node.addEventListener("click", () => {
      menu.hidden = true;
      run();
    });
    return node;
  };
  menu.append(
    entry(t("projects-menu-path"), "path", () => void runChoice(scenes, editor, bar, "path")),
    entry(t("projects-menu-save-as"), "saveAs", () => void runChoice(scenes, editor, bar, "saveAs")),
    entry(t("projects-tabs-panel"), "panel", panel),
  );
  more.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    if (!menu.hidden) menu.querySelector("button")?.focus();
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") menu.hidden = true;
  });
  holder.append(more, menu);
  return holder;
}

/** The arrow keys move the focus between the tabs; Enter opens the tab that has the focus. */
function tabKeys(list: HTMLElement): void {
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = tabs.findIndex((tab) => tab === document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    tabs[(at + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]?.focus();
  });
}

/** Mount the scene tabs in the file bar; `panel` shows the Scenes panel. */
export function startSceneTabs(
  scenes: PageScenes,
  editor: ScenePageEditor,
  bar: SceneBar,
  panel: () => void = () => undefined,
): HTMLElement {
  const strip = document.createElement("span");
  strip.className = "scene-tabs";
  strip.dataset.testid = "scene-tabs";
  const list = document.createElement("span");
  list.className = "scene-tab-list";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", t("projects-tabs"));
  tabKeys(list);
  const add = button("+", "scene-tab-new", t("projects-menu-new"));
  add.setAttribute("aria-label", add.title);
  // The bar asks for the name, as the command scene.new does with a notice.
  add.dataset.command = "scene.new";
  add.addEventListener("click", () => void runChoice(scenes, editor, bar, "new"));
  strip.append(list, add, moreMenu(scenes, editor, bar, panel));
  const holder = document.querySelector("#scene-bar");
  const file = holder?.querySelector('[data-testid="scene-file"]') ?? null;
  if (file !== null) file.before(strip);
  else (holder ?? document.body).prepend(strip);
  const draw = (): void => {
    list.replaceChildren(...scenes.list().map((item) => sceneTab(item)));
  };
  scenes.listen(draw);
  // The dirty mark of the active scene follows the dirty state of the file bar (an edit, an undo, a save).
  if (holder !== null) {
    new MutationObserver(draw).observe(holder, { attributes: true, attributeFilter: ["data-dirty"] });
  }
  draw();
  return strip;
}
