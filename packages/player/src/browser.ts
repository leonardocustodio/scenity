// SPDX-License-Identifier: Apache-2.0
/**
 * The browser parts of a player: the parts of each player (browserBase.ts), the content reader and the page
 * time line, the document client of `@scenity/runtime`, the backend chooser, the audio player, and the URLs of the
 * generic scene worker and of the WASM decoders. The bundler (Vite) builds the worker entry and copies the decoders
 * into the build, so a player loads no code from another origin (the CSP has worker-src 'self' and no Blob workers).
 *
 * The worker of the player (sceneWorker.ts) loads the project plugins of its build. The page loads the same
 * plugin module (`virtual:scenity/plugins`, `plugins.js` of `scenity build`) only for a main-thread core.
 */
import sceneWorkerUrl from "./sceneWorker?worker&url";
import basisWasm from "three/examples/jsm/libs/basis/basis_transcoder.wasm?url";
import dracoWasm from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import { AudioPlayer } from "@scenity/runtime/audio";
import { chooseBackend } from "@scenity/runtime/backend";
import { createDocumentClient, inputsOf } from "@scenity/runtime/documentClient";
import { browserBase } from "./browserBase";
import type { PlayerDeps } from "./deps";
import { loadContentInto, soundFetch } from "./documents";
import { checkEvent, pickDocument } from "./events";
import { loadContent } from "./project";
import { pageTimeline } from "./timeline";

/** The browser parts of the page. */
export function browserDeps(): PlayerDeps {
  return {
    ...browserBase(),
    content: loadContent,
    load: loadContentInto,
    checkEvent,
    pickAt: pickDocument,
    timeline: pageTimeline,
    createClient: createDocumentClient,
    // The events of `send` go through the input channel of the play mode.
    inputLink: inputsOf,
    chooseBackend: () => chooseBackend(),
    workerUrl: sceneWorkerUrl,
    // A dynamic import: the page loads the plugin bundle only for a main-thread core.
    loadPlugins: (set) => import("virtual:scenity/plugins").then((module) => module.loadPlugins(set)),
    decoders: { basisWasm, dracoWasm },
    createAudio: (clock, content) => new AudioPlayer({ clock, fetch: soundFetch((url) => fetch(url), content) }),
  };
}
