// SPDX-License-Identifier: Apache-2.0
/**
 * The hints and the recordings of the play mode, in the view place of the editor window, as the keep list is. The
 * hints show in a play: the keys of the game (playRecordings.ts `inputHints`). The person can close them, and the
 * browser storage keeps that choice. The recordings list has "Save the last play" and a row
 * for each saved recording with Replay and Delete. Each action is a command of the window (`play.hints`,
 * `play.recording.save`, `play.recording.replay`, `play.recording.delete`), so an agent can run it too. DOM nodes only,
 * as the play control.
 */
import { t } from "../../texts";
import { placePart } from "../pageParts";
import type { PageKeyCommandSpec } from "../settings/pageKeys";
import { pageKeys } from "../settings/pageKeys";
import { textOrAsk } from "../projects/fileCommands";
import { currentShell } from "../../studio/shell/shell";
import type { PagePlay } from "./pagePlay";
import { inputHints, readRecordings, withRecording, writeRecordings, type InputHint } from "./playRecordings";

/** The storage key of the choice to hide the hints of the play mode. */
export const HINTS_KEY = "scenity.play.hints";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, testId: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.dataset.testid = testId;
  node.textContent = text;
  return node;
}

function commandButton(command: string, testId: string, text: string, args: Record<string, unknown> = {}) {
  const node = element("button", testId, text);
  node.type = "button";
  node.dataset.command = command;
  node.addEventListener(
    "click",
    () =>
      void pageKeys()
        .execute(command, args)
        .catch(() => undefined),
  );
  return node;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** True when the person closed the hints of the play mode. */
function hintsOff(): boolean {
  try {
    return storage()?.getItem(HINTS_KEY) === "off";
  } catch {
    return false;
  }
}

/** The words of the pointer press of a hint. */
function pointerWords(hint: InputHint): string {
  const pointer = hint.pointer;
  if (pointer === null) return "";
  const button = t(pointer.button === 2 ? "play-hint-right-click" : "play-hint-click");
  return pointer.component === undefined ? button : t("play-hint-on", { press: button, component: pointer.component });
}

/** The hints panel: it shows in a play unless the person closed it. */
function hintsPanel(play: PagePlay): { readonly node: HTMLElement; update(): Promise<void> } {
  const node = element("div", "play-hints");
  node.id = "scene-play-hints";
  node.setAttribute("role", "note");
  node.setAttribute("aria-label", t("play-hints"));
  node.hidden = true;
  const update = async (): Promise<void> => {
    const off = hintsOff();
    const maps = play.active && !off ? ((await play.parts.input?.maps()) ?? []) : [];
    const hints = inputHints(maps);
    node.hidden = !play.active || off || hints.length === 0;
    if (node.hidden) return;
    const rows = hints.map((hint) => {
      const row = element("li", "play-hint");
      row.dataset.action = hint.action;
      const name = element("span", "play-hint-action", hint.action);
      name.setAttribute("translate", "no");
      const how = [...hint.keys, ...(hint.pointer === null ? [] : [pointerWords(hint)])].join(" · ");
      row.append(name, element("span", "play-hint-keys", how));
      return row;
    });
    const list = element("ul", "play-hint-list");
    list.append(...rows);
    const close = commandButton("play.hints", "play-hints-close", "×", { show: false });
    close.title = t("play-hints-close");
    close.setAttribute("aria-label", close.title);
    node.replaceChildren(element("strong", "play-hints-title", t("play-hints")), close, list);
  };
  placePart(node, "view");
  return { node, update };
}

/** The recordings list: Save the last play, and Replay and Delete of each saved recording. */
function recordingsPanel(play: PagePlay): { readonly node: HTMLElement; toggle(): void; update(): void } {
  const node = element("div", "play-recordings");
  node.id = "scene-play-recordings";
  node.setAttribute("aria-label", t("play-recordings"));
  node.hidden = true;
  const update = (): void => {
    if (node.hidden) return;
    const project = play.parts.input?.project ?? "";
    const rows = readRecordings(storage(), project).map((saved) => {
      const row = element("li", "play-recording");
      row.dataset.name = saved.name;
      const name = element("span", "play-recording-name", saved.name);
      name.setAttribute("translate", "no");
      const count = element(
        "span",
        "play-recording-count",
        t("play-recording-count", { count: saved.recording.events.length }),
      );
      const replay = commandButton("play.recording.replay", "play-recording-replay", t("play-replay"), {
        name: saved.name,
      });
      const remove = commandButton("play.recording.delete", "play-recording-delete", t("play-recording-delete"), {
        name: saved.name,
      });
      row.append(name, count, replay, remove);
      return row;
    });
    const save = commandButton("play.recording.save", "play-recording-save", t("play-recording-save"));
    save.disabled = (play.parts.input?.recording() ?? null) === null;
    const list = element("ul", "play-recording-list");
    list.append(...rows);
    const empty = rows.length === 0 ? [element("p", "play-recordings-empty", t("play-recordings-empty"))] : [];
    node.replaceChildren(element("strong", "play-recordings-title", t("play-recordings")), save, ...empty, list);
  };
  placePart(node, "view");
  return {
    node,
    update,
    toggle: () => {
      node.hidden = !node.hidden;
      update();
    },
  };
}

/** The saved recording of a name of a run, or an error. */
function savedOf(play: PagePlay, name: unknown) {
  const found = readRecordings(storage(), play.parts.input?.project ?? "").find((item) => item.name === name);
  if (found === undefined) throw new Error(t("play-recording-none", { name: String(name) }));
  return found;
}

/** The commands of the hints and of the recordings. */
function panelCommands(
  play: PagePlay,
  hints: ReturnType<typeof hintsPanel>,
  recordings: ReturnType<typeof recordingsPanel>,
): PageKeyCommandSpec[] {
  const nameArg = { name: { type: "string" as const, description: t("play-recording-arg-name"), optional: true } };
  const keep = (list: Parameters<typeof writeRecordings>[2]): void => {
    if (!writeRecordings(storage(), play.parts.input?.project ?? "", list)) throw new Error(t("play-recording-full"));
    recordings.update();
  };
  return [
    {
      id: "play.hints",
      title: t("play-hints-title"),
      args: { show: { type: "boolean", description: t("play-hints-arg-show"), optional: true } },
      run: (args) => {
        try {
          storage()?.setItem(HINTS_KEY, args.show === false ? "off" : "on");
        } catch {
          // No storage: the choice holds until the next update only.
        }
        void hints.update();
      },
    },
    { id: "play.recordings", menu: "edit", title: t("play-recordings-title"), run: () => recordings.toggle() },
    {
      id: "play.recording.save",
      title: t("play-recording-save-title"),
      agents: true,
      args: nameArg,
      run: async (args) => {
        const recording = play.parts.input?.recording() ?? null;
        if (recording === null) throw new Error(t("play-command-no-replay"));
        const notices = currentShell()?.notices;
        const ask = { title: t("play-recording-save-title"), label: t("play-recording-arg-name") };
        const name = notices === undefined ? String(args.name ?? "") : await textOrAsk(notices, args, "name", ask);
        if (name === null || name.trim() === "") return;
        const project = play.parts.input?.project ?? "";
        keep(withRecording(readRecordings(storage(), project), name.trim(), recording, Date.now()));
      },
    },
    {
      id: "play.recording.replay",
      title: t("play-recording-replay-title"),
      agents: true,
      args: {
        name: { ...nameArg.name, optional: false },
        view: { type: "string", description: t("play-recording-arg-view"), optional: true, values: ["game", "scene"] },
      },
      when: () => (play.active ? t("play-command-running") : null),
      run: (args) => {
        const view = args.view === "scene" ? "scene" : "game";
        const reason = play.start(savedOf(play, args.name).recording, { view });
        if (reason !== null) throw new Error(reason);
      },
    },
    {
      id: "play.recording.delete",
      title: t("play-recording-delete-title"),
      agents: true,
      args: { name: { ...nameArg.name, optional: false } },
      run: (args) => {
        const found = savedOf(play, args.name);
        const project = play.parts.input?.project ?? "";
        keep(readRecordings(storage(), project).filter((item) => item.name !== found.name));
      },
    },
  ];
}

/** Start the hints and the recordings of the play mode; the result is the button of the recordings list. */
export function startPlayPanels(play: PagePlay): HTMLButtonElement {
  const hints = hintsPanel(play);
  const recordings = recordingsPanel(play);
  pageKeys().register(panelCommands(play, hints, recordings));
  play.listen(() => {
    void hints.update();
    recordings.update();
  });
  // A glyph button with a label: a text button would push the grid snap out of the toolbar of a small window.
  const button = commandButton("play.recordings", "play-recordings-open", "⏺");
  button.setAttribute("aria-label", t("play-recordings"));
  button.title = t("play-recordings-title");
  return button;
}
