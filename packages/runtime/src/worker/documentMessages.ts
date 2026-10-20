// SPDX-License-Identifier: Apache-2.0
/**
 * The factory of the generic scene worker: the document core with no plugin input. The view camera uses the "camera"
 * message of the protocol (protocol.ts).
 *
 * The factory gives the core an `audio` event that posts the "audio" message of the protocol. The event is
 * here and not in the shared handler, so the worker of a plugin core keeps its size.
 *
 * A worker entry can give a plugin loader. The worker then loads the project plugins at "init" from the plugin module
 * of its own build (`virtual:scenity/plugins`). Each plugin has its own chunk, so the worker uses the ES format. The
 * plugins share the three.js and the runtime of the worker. The page sends only the name of the plugin set
 * (`init.plugins`), never code or a module URL: the CSP stays (no eval, no Blob worker).
 */
import type { InputEvent } from "@scenity/scene/input";
import type { DocumentCore } from "../core/documentCore";
import type { DocumentPluginSource } from "../core/documentPlugins";
import type { RuntimePlugin } from "../plugins/types";
import type { AudioFrame, ExtensionMessage, FromWorker, InitMessage, InputSchema, SceneCoreOptions } from "../protocol";
import type { SceneWorkerFactory } from "./handler";

/** A document core has no plugin input: each "state" value passes, and the core ignores it. */
const ANY_INPUT: InputSchema<unknown> = { safeParse: (value) => ({ success: true, data: value }) };

/** The extension message that sets the selection of the outline (`DocumentCore.select`). */
export interface SelectMessage extends ExtensionMessage {
  readonly type: "select";
  readonly ids: readonly string[];
}

/**
 * The extension message of the input events of the play mode (`DocumentCore.setInputs`). `replace` removes the events
 * that came before them (the start of a play, or a replay of a recording).
 */
export interface InputsMessage extends ExtensionMessage {
  readonly type: "inputs";
  readonly events: readonly InputEvent[];
  readonly replace: boolean;
}

/**
 * Apply an extension message of the document core ("select" or "inputs"). False for a message of another extension.
 * Thus a worker of a subclass can handle its own messages first and give the rest to this function.
 */
export function handleDocumentMessage(message: ExtensionMessage, core: DocumentCore): boolean {
  if (message.type === "inputs" && Array.isArray(message.events)) {
    const { events, replace } = message as Partial<InputsMessage>;
    core.setInputs(events ?? [], replace ?? false);
    return true;
  }
  if (message.type !== "select" || !Array.isArray(message.ids)) return false;
  core.select((message as SelectMessage).ids.filter((id): id is string => typeof id === "string"));
  return true;
}

/**
 * The plugin loader of a worker entry. `set` is the name of the plugin set that the page gives (`init.plugins`). A host
 * with many projects (the scene server of the editor) picks the plugins of one project with it.
 */
export type WorkerPluginLoader = (set: string | undefined) => Promise<readonly RuntimePlugin[]>;

/** The name of the plugin set of an "init" message, or undefined. */
export function pluginSetOf(init: InitMessage): string | undefined {
  const set = (init as { readonly plugins?: unknown }).plugins;
  return typeof set === "string" ? set : undefined;
}

/** The options of the core in a worker: the core options and the plugins of the loader. */
export type DocumentWorkerOptions = SceneCoreOptions & { readonly plugins?: DocumentPluginSource };

/**
 * The factory of the generic scene worker: the document core, or a subclass of it (for example the dev document core).
 * `post` sends the audio frames to the page. `plugins` loads the project plugins at "init".
 */
export function documentWorkerFactory<Core extends DocumentCore = DocumentCore>(
  create: (options: DocumentWorkerOptions, init: InitMessage) => Core,
  post?: (message: FromWorker) => void,
  plugins?: WorkerPluginLoader,
): SceneWorkerFactory<unknown, Core> {
  return {
    input: ANY_INPUT,
    createCore: (options, init) => {
      const loaded = plugins === undefined ? options : { ...options, plugins: plugins(pluginSetOf(init)) };
      if (post === undefined) return create(loaded, init);
      const audio = (frame: AudioFrame): void => {
        post({ type: "audio", frame });
      };
      const events = { ...options.events, audio };
      return create({ ...loaded, events }, init);
    },
    handle: (message, core) => {
      handleDocumentMessage(message, core);
    },
  };
}
