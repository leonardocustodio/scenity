// SPDX-License-Identifier: Apache-2.0
// The script of the play window (player/play.html). It plays the documents of the handoff of the scene page
// (handoff.ts) with @scenity/player from 0 ms. The page holds no editor code. The edit view of the scene page does not
// change. A recording in the handoff replays in place of the live input. `data-state` on the stage is the state of the
// player, and `__scenityPlay` gives the player to the tests. The texts are Fluent messages of
// `src/i18n/en-US/player.ftl`. The `locale` parameter of the URL selects the locale. The `tier`, `backend` and
// `worker=0` parameters of the URL go to the player. The Game view of the editor embeds this page with them.
import { createPlayer, type Player, type PlayerBackend } from "@scenity/player";
import type { Tier } from "@scenity/runtime/protocol";
import { readInputRecording, type InputRecording } from "@scenity/scene/sequence";
import { t } from "../texts";
import { readHandoff, writeHandoff, type HandoffStorage, type PlayHandoff } from "./handoff";

declare global {
  var __scenityPlay: Player | undefined;
}

/** A browser storage, or null when the browser blocks it. */
function storage(kind: "localStorage" | "sessionStorage"): HandoffStorage | null {
  try {
    return globalThis[kind];
  } catch {
    return null;
  }
}

/** The handoff of the key: from the session storage after a reload, else out of the local storage. */
function handoffOf(key: string): PlayHandoff | null {
  const session = storage("sessionStorage");
  const kept = session === null ? null : readHandoff(session, key);
  if (kept !== null) return kept;
  const local = storage("localStorage");
  const taken = local === null ? null : readHandoff(local, key, true);
  if (taken !== null && session !== null) writeHandoff(session, key, taken);
  return taken;
}

/** The input recording of a handoff when the reader accepts it, else true (the live input). */
function replayOf(handoff: PlayHandoff): InputRecording | true {
  if (handoff.recording === undefined) return true;
  const read = readInputRecording(handoff.recording);
  if (read.ok) return read.doc;
  console.warn(`[scenity] the input recording of the handoff is not valid: ${read.errors[0]?.message ?? ""}`);
  return true;
}

/** The render options of the URL (the Game view of the editor sets them): the tier, the backend, the worker. */
export function renderOptions(params: URLSearchParams): { tier?: Tier; backend?: PlayerBackend; worker?: boolean } {
  const tier = TIERS.find((item) => item === params.get("tier"));
  const backend = BACKENDS.find((item) => item === params.get("backend"));
  return {
    ...(tier === undefined ? {} : { tier }),
    ...(backend === undefined ? {} : { backend }),
    ...(params.get("worker") === "0" ? { worker: false } : {}),
  };
}

const TIERS: readonly Tier[] = ["ultra", "high", "medium", "low"];
const BACKENDS: readonly PlayerBackend[] = ["auto", "webgl", "webgpu"];

function start(): void {
  const stage = document.querySelector<HTMLElement>("#stage");
  const status = document.querySelector("#status");
  if (stage === null) throw new Error("the play page has no stage");
  const handoff = handoffOf(new URLSearchParams(location.search).get("handoff") ?? "");
  if (handoff === null) {
    stage.dataset.state = "failed";
    if (status !== null) status.textContent = t("player-no-handoff");
    return;
  }
  document.title = t("player-title", { project: handoff.project });
  const player = createPlayer(stage, {
    ...renderOptions(new URLSearchParams(location.search)),
    project: `/projects/${handoff.project}/scenity.project.json`,
    scene: handoff.scene,
    sequence: handoff.sequence,
    ...(handoff.camera === null ? {} : { camera: handoff.camera }),
    autoplay: true,
    // The plugin set of the project on the scene server: the player runs the project plugins.
    plugins: handoff.project,
    // The recording of the handoff replays. Else the keys and the pointer give the input events.
    input: replayOf(handoff),
  });
  globalThis.__scenityPlay = player;
  stage.dataset.state = "loading";
  player.ready.then(
    () => {
      stage.dataset.state = "ready";
    },
    (error: unknown) => {
      stage.dataset.state = "failed";
      const reason = error instanceof Error ? error.message : String(error);
      if (status !== null) status.textContent = t("player-error", { reason });
    },
  );
}

start();
