// SPDX-License-Identifier: Apache-2.0
/**
 * The input of the play mode of the scene page. In the play mode, the keys of the page and the pointer on the canvas
 * give the input events of the input maps of the project plugins (`PageInput` of `@scenity/runtime/pageInput`). The
 * core of the page applies them at the system steps. The session
 * records the events with their times: Stop keeps the recording, and a play with `replay` gives the recorded events
 * to the core in place of the live input, so the frames are the frames of the live session.
 *
 * The edit mode gets no input events: Stop sends an empty list. The keys with ⌘, Ctrl or Alt stay editor keys (the key
 * map of the page commands is a different map). No Vue.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { inputRecording, type InputRecording } from "@scenity/scene/sequence";
import type { InputEvent } from "@scenity/scene/input";
import type { DocumentCore } from "@scenity/runtime/documentCore";
import { inputsOf } from "@scenity/runtime/documentClient";
import type { SceneLink } from "@scenity/runtime/client";
import type { InputMap } from "@scenity/runtime/inputMap";
import { PageInput } from "@scenity/runtime/pageInput";
import type { PickHit } from "@scenity/runtime/protocol";
import { loadProjectPlugins } from "virtual:scenity/project-plugins";

/** The channel of the input events to the core of the page. `link` goes to the `link` option of the client. */
export class PlayInputLink {
  #send: ((events: readonly InputEvent[], replace: boolean) => void) | null = null;

  readonly link = (link: SceneLink<DocumentCore>): void => {
    this.#send = inputsOf(link);
  };

  /** Send events to the core; nothing goes before the client gives its link. */
  send(events: readonly InputEvent[], replace: boolean): void {
    this.#send?.(events, replace);
  }
}

/** What the input of the play mode reads of the page. */
export interface PlayInputParts {
  readonly link: PlayInputLink;
  readonly project: string;
  readonly canvas: HTMLCanvasElement;
  /** The time of the page clock in ms, or null with no clock. */
  time(): number | null;
  pick(x: number, y: number): Promise<PickHit | null>;
  /** The current scene of the play state (the components of a hit entity). */
  doc(): SceneDocument;
  /** The ID of the open sequence, or undefined. */
  sequence(): string | undefined;
  /** The input maps of the project plugins (default: the plugins of the scene server). */
  maps?(): Promise<readonly InputMap[]>;
}

/** The input maps of the plugins of a project on the scene server. */
async function projectMaps(project: string): Promise<InputMap[]> {
  const plugins = await loadProjectPlugins(project);
  return plugins.flatMap((plugin) => (plugin.inputMap === undefined ? [] : [plugin.inputMap]));
}

export class PlayInput {
  readonly #parts: PlayInputParts;
  #input: Promise<PageInput> | null = null;
  #count = 0;
  #last: InputRecording | null = null;

  constructor(parts: PlayInputParts) {
    this.#parts = parts;
  }

  /** The recording of the current play session, else of the last one; null before the first play. */
  recording(): InputRecording | null {
    return this.#last;
  }

  /** The project of the input (the saved recordings are per project). */
  get project(): string {
    return this.#parts.project;
  }

  /** The input maps of the project plugins (the hints of the play mode show them). */
  maps(): Promise<readonly InputMap[]> {
    return this.#parts.maps?.() ?? projectMaps(this.#parts.project);
  }

  /** Start the input of a play: the live input, or the events of a recording with `replay`. */
  async start(replay?: InputRecording): Promise<void> {
    const input = await this.#open();
    if (replay === undefined) input.start();
    else input.replay(replay.events);
    this.#count += 1;
    this.#keep(input);
  }

  /** Stop the input: the core drops the events, and the recording stays. */
  async stop(): Promise<void> {
    if (this.#input === null) return;
    const input = await this.#input;
    this.#keep(input);
    input.stop();
  }

  /** Keep the current events of the input as the recording. */
  #keep(input: PageInput): void {
    const parts = this.#parts;
    const id = `play-${String(this.#count)}`;
    this.#last = inputRecording({ id, scene: parts.doc().id, sequence: parts.sequence(), events: input.events });
  }

  /** The page input with the maps of the project and the DOM listeners (once). */
  #open(): Promise<PageInput> {
    this.#input ??= (this.#parts.maps?.() ?? projectMaps(this.#parts.project)).then((maps) => {
      const { link, canvas } = this.#parts;
      const input = new PageInput({
        maps,
        time: () => this.#parts.time(),
        pick: (x, y) => this.#parts.pick(x, y),
        components: (entity) => {
          const components = this.#parts.doc().entities[entity]?.components;
          return components === undefined ? null : Object.keys(components);
        },
        send: (events, replace) => {
          link.send(events, replace);
          // The recording follows each live event, so a script can read it during the play.
          if (!replace && input.live) this.#keep(input);
        },
      });
      input.listen({ keys: window, pointer: canvas });
      return input;
    });
    return this.#input;
  }
}

/** The page parts of `playInputOf`: the link of the client, the project, the canvas and the pick. */
export interface PlayInputPage {
  readonly input?: PlayInputLink;
  readonly project: string;
  readonly canvas: HTMLCanvasElement;
  pick(x: number, y: number): Promise<PickHit | null>;
}

/** The input of the play mode of an editor and its open sequence, or no field when the page gives no link. */
export function playInputOf(
  page: PlayInputPage,
  editor: { readonly doc: SceneDocument },
  sequence: { readonly time: { now(): number }; readonly channel: { readonly doc: { readonly id: string } } } | null,
): { input?: PlayInput } {
  const link = page.input;
  if (link === undefined) return {};
  const { project, canvas } = page;
  const input = new PlayInput({
    ...{ link, project, canvas },
    time: () => sequence?.time.now() ?? null,
    pick: (x, y) => page.pick(x, y),
    doc: () => editor.doc,
    sequence: () => sequence?.channel.doc.id,
  });
  return { input };
}
