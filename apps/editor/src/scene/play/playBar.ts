// SPDX-License-Identifier: Apache-2.0
/**
 * The play control of the scene page in the edit mode: a group in the file bar with Play, Stop, Keep and "Play in a
 * window", and the keep list. The Stop button is orange while the play mode runs. The keep list shows each change of
 * the play state with a check box (all checked at the start). "Keep checked" stops the play mode and applies the
 * checked changes as one step of the history. Replay plays again from 0 ms with the input events of the last play
 * session in place of the live input. The page tint of the play mode is in play.css. The texts are Fluent messages of
 * `src/i18n/en-US/play.ftl`, and the label of a change comes from `@scenity/editor-core`. The control uses DOM nodes
 * only (no HTML text), as the file bar does.
 *
 * Each button runs a command of the window (`play.start`, `play.replay`, `play.stop`, `play.keep`, `play.window`).
 * Thus a key, the search box and an agent run the same actions.
 *
 * The control is the clock group in the centre of the toolbar: Play (⌘P), Pause (⌘⇧P: the clock stops or continues),
 * Step (⌥⌘P: one frame forward with the clock stopped) and the time of the clock. Recordings opens the list of the
 * saved recordings (playPanels.ts).
 */
import type { PlayChange } from "@scenity/editor-core";
import { t } from "../../texts";
import { placePart } from "../pageParts";
import { pageKeys, type PageKeyCommandSpec } from "../settings/pageKeys";
import { PagePlay, type PlayParts } from "./pagePlay";
import { startPlayPanels } from "./playPanels";
import "./play.css";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, testId: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.dataset.testid = testId;
  node.textContent = text;
  return node;
}

function button(testId: string, text: string, title: string, run: () => void): HTMLButtonElement {
  const node = element("button", testId, text);
  node.type = "button";
  node.title = title;
  node.addEventListener("click", run);
  return node;
}

/** A button that runs a command of the window. */
function commandButton(command: string, testId: string, text: string, title: string): HTMLButtonElement {
  const node = button(testId, text, title, () => void pageKeys().run(command));
  node.dataset.command = command;
  return node;
}

/** One row of the keep list: a check box and the label of the change. */
function changeRow(change: PlayChange): { row: HTMLLabelElement; box: HTMLInputElement } {
  const row = element("label", "play-change");
  row.dataset.change = change.id;
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = true;
  box.value = change.id;
  row.append(box, document.createTextNode(change.label));
  return { row, box };
}

/** The keep list: the current changes, Keep checked and Cancel. */
function keepList(play: PagePlay): { readonly node: HTMLElement; show(): void; hide(): void } {
  const node = element("div", "play-keep-list");
  node.id = "scene-play-keep";
  node.hidden = true;
  const hide = (): void => {
    node.hidden = true;
    node.replaceChildren();
  };
  const show = (): void => {
    const rows = play.changes().map(changeRow);
    const title = element("strong", "play-keep-title", rows.length === 0 ? t("play-keep-none") : t("play-keep-list"));
    const list = element("div", "play-keep-rows");
    list.append(...rows.map(({ row }) => row));
    const apply = button("play-keep-apply", t("play-keep-apply"), t("play-keep-apply-title"), () => {
      const ids = rows.filter(({ box }) => box.checked).map(({ box }) => box.value);
      hide();
      play.keep(ids);
    });
    apply.disabled = rows.length === 0;
    const cancel = button("play-keep-cancel", t("play-keep-cancel"), t("play-keep-cancel-title"), hide);
    node.replaceChildren(title, list, apply, cancel);
    node.hidden = false;
  };
  placePart(node, "view");
  return { node, show, hide };
}

/** The time of one step of Step (ms): one frame at 60 frames per second. */
const STEP_MS = 1000 / 60;
/** The wait between two updates of the time field (ms). */
const TIME_MS = 100;

/** The commands of the clock in the play mode: Pause and Step. */
function clockCommands(play: PagePlay): PageKeyCommandSpec[] {
  const ready = (): string | null => {
    if (!play.active) return t("play-command-stopped");
    return play.parts.time === null ? t("play-command-no-clock") : null;
  };
  return [
    {
      id: "play.pause",
      title: t("play-pause-title"),
      keys: ["Mod+Shift+P"],
      menu: "edit",
      inText: true,
      when: ready,
      run: () => {
        const time = play.parts.time;
        if (time === null) return;
        if (time.playing()) time.pause();
        else time.play();
      },
    },
    {
      id: "play.step",
      title: t("play-step-title"),
      keys: ["Mod+Alt+P"],
      menu: "edit",
      inText: true,
      when: ready,
      run: () => {
        const time = play.parts.time;
        if (time === null) return;
        time.pause();
        time.seek(time.now() + STEP_MS);
      },
    },
  ];
}

/** The time of the clock in seconds; it shows only when the page has a clock. */
function timeField(play: PagePlay): HTMLElement {
  const field = element("span", "play-time");
  field.setAttribute("translate", "no");
  const time = play.parts.time;
  field.hidden = time === null;
  if (time === null) return field;
  const show = (): void => {
    field.textContent = t("play-time", { seconds: (time.now() / 1000).toFixed(2) });
  };
  show();
  setInterval(show, TIME_MS);
  return field;
}

/** Mount the play control in the clock place of the toolbar (or at the end of the body with no editor window). */
export function playBar(play: PagePlay): void {
  const group = element("span", "scene-play");
  group.id = "scene-play";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t("play-group"));
  const keep = keepList(play);
  const start = commandButton("play.start", "play-start", t("play-start"), t("play-start-title"));
  const stop = commandButton("play.stop", "play-stop", t("play-stop"), t("play-stop-title"));
  const keepButton = commandButton("play.keep", "play-keep", t("play-keep"), t("play-keep-title"));
  const replay = commandButton("play.replay", "play-replay", t("play-replay"), t("play-replay-title"));
  const popup = commandButton("play.window", "play-window", "⧉", t("play-window-title"));
  const pause = commandButton("play.pause", "play-pause", t("play-pause"), t("play-pause-title"));
  const step = commandButton("play.step", "play-step", t("play-step"), t("play-step-title"));
  pageKeys().register([...playCommands(play, { keep, start, popup }), ...clockCommands(play)]);
  const show = (active: boolean): void => {
    group.dataset.active = active ? "1" : "0";
    start.hidden = active;
    stop.hidden = !active;
    keepButton.hidden = !active;
    pause.hidden = !active || play.parts.time === null;
    step.hidden = pause.hidden;
    replay.hidden = active || (play.parts.input?.recording() ?? null) === null;
    if (!active) keep.hide();
  };
  // The hints of the game in a play, and the saved recordings.
  const recordings = startPlayPanels(play);
  group.append(start, replay, pause, step, stop, keepButton, timeField(play), recordings, popup);
  show(play.active);
  play.listen(show);
  placePart(group, "clock");
}

/** The commands of the play control; `nodes` are the parts of the control that a command changes. */
function playCommands(
  play: PagePlay,
  nodes: { keep: ReturnType<typeof keepList>; start: HTMLButtonElement; popup: HTMLButtonElement },
): PageKeyCommandSpec[] {
  const recording = (): ReturnType<NonNullable<PlayParts["input"]>["recording"]> | null =>
    play.parts.input?.recording() ?? null;
  return [
    {
      id: "play.start",
      menu: "edit",
      title: t("play-start-title"),
      when: () => (play.active ? t("play-command-running") : null),
      run: () => {
        const reason = play.start();
        if (reason !== null) nodes.start.title = reason;
      },
    },
    {
      id: "play.replay",
      menu: "edit",
      title: t("play-replay-title"),
      when: () => (play.active || recording() === null ? t("play-command-no-replay") : null),
      run: () => {
        const input = recording();
        if (input !== null) play.start(input);
      },
    },
    {
      id: "play.stop",
      menu: "edit",
      title: t("play-stop-title"),
      when: () => (play.active ? null : t("play-command-stopped")),
      run: () => {
        nodes.keep.hide();
        play.stop();
      },
    },
    {
      id: "play.keep",
      title: t("play-keep-title"),
      when: () => (play.active ? null : t("play-command-stopped")),
      run: () => {
        if (nodes.keep.node.hidden) nodes.keep.show();
        else nodes.keep.hide();
      },
    },
    {
      id: "play.window",
      title: t("play-window-title"),
      run: () => {
        nodes.popup.dataset.opened = play.openWindow() ? "1" : "0";
      },
    },
  ];
}

/** Start the play mode of the page: the controller and its control in the file bar. */
export function startPlay(parts: PlayParts): PagePlay {
  const play = new PagePlay(parts);
  playBar(play);
  return play;
}
