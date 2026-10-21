# @scenity/player

The player of Scenity: the runtime with the documents of a project, a sequence or a simulation, with
no editor and no dev code. It has a JavaScript API, a Vue component and the web component `<scenity-player>`.

## Use

```ts
import { createPlayer } from "@scenity/player";

const player = createPlayer(container, {
  project: "/projects/characters/scenity.project.json",
  scene: "scenes/main.scene.json",
  sequence: "sequences/walk-wave.sequence.json",
  camera: "front",
  autoplay: true,
  loop: true,
});
player.on("marker", ({ name, t }) => console.log(name, t));
await player.ready;
await player.seek(2500);
```

```html
<script type="module">
  import "@scenity/player/element";
</script>
<scenity-player src="/projects/showroom/scenity.project.json" scene="scenes/main.scene.json" autoplay loop>
</scenity-player>
```

```vue
<ScenityPlayer project="/projects/showroom/scenity.project.json" camera="front" @ready="onReady" />
```

## Embedding

The page gives the player plugin input and events, and gets picks and screen points back:

```ts
player.setInput("doors", { open: true }); // checked with the `schemas` option or the schema of a plugin core
player.send({ kind: "press", action: "doors.toggle", entity: "door" }); // an input event at the clock time
player.setSource(recordedSource(stream)); // a SimulationSource: a recorded stream or a live engine
player.watchPoints(["entity:cart", "entity:cart#top"]);
player.on("points", (frame) => placeOverlays(frame.points)); // CSS pixels of the canvas, the reference as the ID
player.on("pick", ({ entity, sub, point }) => select(entity));
player.on("time", ({ t, playing }) => showClock(t));
```

- The input message of a document core is the map by plugin ID: the page input, then the source input of its plugin
  at the clock time, then the `project` output of a `simulation`. The source sends a new input only for a new state
  object (a recorded sample or a live push). With no sequence, a recorded source gives the time line; a live source
  moves the clock to the time of each push.
- `send` gives the event the clock time and sends it over the input channel of the document core (`inputsOf`):
  the systems get it at the first system step at or after that time (`ctx.inputs`); `player.events` keeps the
  log, and a new core after a fallback gets it again.
- A plugin core (the `core` option, `PlayerPluginCore`) draws a scene of its own with no documents: the player uses
  its client and worker, sends it the input of its plugin as it is, maps its projected points to references with
  `refOf`, and turns its pointer hits into `pick` events. It takes the events of `send` only through its
  `sendEvents`. `@scenity/player/light` (`createLightPlayer`) is the player of a plugin core with no document reader,
  no evaluator, no generic worker, no document loader (`documents.ts`) and no event check or document pick
  (`events.ts`): those are deps of the full player (`browser.ts`), so a page of a plugin core does not carry them.
- The web component has `setInput`, `send`, `watchPoints` and the properties `source` and `core`, and sends `pick`,
  `points` and `time` as DOM events. The Vue component has the props `inputs`, `source`, `points`, `core` and
  `schemas`, emits `pick`, `points` and `time`, and exposes `send`.

The plain pages `apps/editor/player/showroom.html` and `apps/editor/player/characters.html` use the web component (the
scene dev server: `bun run --filter @scenity/editor dev:scene`, then `/player/showroom.html`).

## File map

| To change                                                           | Edit                                  |
| ------------------------------------------------------------------- | ------------------------------------- |
| The options, the handle and the events                              | `src/types.ts`                        |
| The life cycle: load, play, pause, seek, events                     | `src/player.ts`                       |
| The browser parts as an interface                                   | `src/deps.ts`                         |
| The embedding state: input, events, points, picks                   | `src/embed.ts`                        |
| The clock of a simulation source; the first frame of a plugin core  | `src/source.ts`                       |
| The light player of a plugin core                                   | `src/light.ts`, `src/browserBase.ts`  |
| The document load, the sounds, the event check, the document pick   | `src/documents.ts`, `src/events.ts`   |
| The renderer plans and the fallbacks                                | `src/fallback.ts`, `src/renderer.ts`  |
| The poster of a scene                                               | `src/poster.ts`                       |
| The adaptive quality ladder                                         | `src/quality.ts`                      |
| The project, the scene, the sequence and the asset manifest         | `src/project.ts`                      |
| The markers, the event keys and the simulation input of a play step | `src/timeline.ts`                     |
| The clock                                                           | `src/clock.ts`                        |
| The browser parts (the worker URL, the decoders, the audio player)  | `src/browser.ts`                      |
| The worker with the project plugins of the build                    | `src/sceneWorker.ts`                  |
| The web component and its attributes                                | `src/element.ts`, `src/attributes.ts` |
| The Vue component                                                   | `src/ScenityPlayer.vue`               |
| The Vite build of the entries                                       | `scripts/build.ts`                    |

## Rules

- No editor, no dev code and no lab code: the player uses the release document core of `@scenity/runtime`, never the
  dev core of `@scenity/runtime-dev`. ESLint and `bun run check:boundaries` check the imports;
  `scenity build` (`packages/cli/src/build`) builds the entries with `scripts/build.ts`, runs the marker gate
  on the source maps and the scripts, and checks the size budgets of the project (`build.budgets`).
- "auto" asks the backend chooser of the runtime (`chooseBackend()`, the rule of the lab and of the plugin views) and
  draws with the generic scene worker (WebGL) when the browser can run it; with no worker the choice (WebGL or
  WebGPU) draws on the main thread. The generic scene worker has no WebGPU entry yet. `backend: "webgl"` is the kill
  switch: no WebGPU call.
- The fallbacks: a WebGPU failure (no adapter, no device, a GPU error in the first frame, a lost
  device) starts WebGL; a worker failure (no OffscreenCanvas, a Worker constructor that throws, a worker error)
  starts the main thread; no first frame in 15 s starts the next plan. Each start is on a new canvas. Each step is a
  `fallback` event and an entry of `player.fallbacks` (`from`, `to`, `reason`); when no backend is left (`to: null`)
  the player enters the error state and keeps the poster. A failure after the first frame starts the next plan at the
  clock time, and the play continues.
- The poster: the `poster` field of the scene document (a path relative to the scene file), or the `poster`
  option (null: none). It shows at once and hides at the first frame. `scenity build` copies it.
- The adaptive quality ladder: in a live play, the ladder measures the frame work p95 of each second. Two windows in a
  row over 6 ms step the tier down; eight windows in a row at most 3 ms step it up. The ladder stays within `quality.tiers` of the
  project and never goes above the `tier` option. A pause, a seek and the end restore the tier of the options before
  the frame of the stopped clock, so a frame at a stopped clock is the same after a play or a seek. `adaptive: false`
  disables it; each step is a `quality` event. `simulateFrameWork(ms)` is the test hook of the e2e tests.
- The project plugins: the document core runs the runtime faces of the plugins of the build (components,
  presenters, simulations, systems). The worker of the player (`src/sceneWorker.ts`) imports `virtual:scenity/plugins`
  of its build (`scenity build`: the plugins of the project, one ES chunk each); the page loads the same module
  (`plugins.js`) only for a main-thread core. The `plugins` option (the `plugins` attribute) names the plugin set on a
  server with many projects (the scene server of the editor); `scenity build` ignores it. A build with no project
  plugins gets an empty module (`scripts/build.ts`). A `simulation` option still runs on the page; its `project` output
  goes to the core as the plugin input. The e2e test: `apps/editor/tests/gallery/plugins.spec.ts` (the spin sample).
- The e2e tests of the fallbacks: `apps/editor/tests/gallery/player-fallback.spec.ts`.
