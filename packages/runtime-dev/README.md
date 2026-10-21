# @scenity/runtime-dev

The dev tools of the runtime: the lab tools of a scene core. Only the editor, the dev part and the editor face of a
plugin import this package; a player build never holds it. It can import only
`@scenity/scene`, `@scenity/render`, `@scenity/character`, `@scenity/runtime` and three.js, and it names no domain. The dev extension of a plugin (`plugins/<plugin>/dev`) binds it to the core of the plugin.

## The dev core

`withDevCore(Base)` (`devCore.ts`) is a mixin over a class of the generic `SceneCore` of `@scenity/runtime/sceneCore`. It
adds the lab tools to the core of a plugin through the hooks of the scene core: no lab code goes into the runtime. The
chain is `withDevCore` → `withLayers` (`layersCore.ts`) → `withPanes` (`panesCore.ts`) → the core of the plugin.

```ts
class LabsCore extends withDevCore(MyPluginCore) {
  protected override devFigures() {
    /* the members that the last update drew: id, root, visible, clip, family, hands, joints() */
  }
  protected override devPoints() {
    /* the named work points of the scene */
  }
  protected override devPlaces() {
    /* the places of the props by slot */
  }
  override inspect() {
    /* the inspect report of the plugin */
  }
}
```

| Hook                                        | What the plugin gives                                                                       | Default        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------- |
| `devFigures()`                              | The figures that the last update drew (the pick, the outline, the onion skin, the captures) | none           |
| `devPoints()`                               | The named work points (the near points of a pick, the points of the report)                 | none           |
| `devPlaces()`                               | The places of the props by slot (the outline, the ghosts, the pick, the prop boxes)         | none           |
| `debugScene()`                              | The obstacles, stand points, walks and routes of the generic debug layers                   | none           |
| `inspect()`                                 | The inspect report of a frame (the plugin extends `InspectReport` and `MemberReport`)       | no members     |
| `movesPlaces`, `placeAgain`, `tunesApplied` | The effects of the tune values: place the props again, apply the lights                     | no effect      |
| `traceReads(draw)`                          | The reads of the plugin code in one frame of the frame index                                | unknown (null) |
| `poseMs`                                    | The plugin adds the time that it poses the figures in each update (the statistics)          | 0              |

`useDevPlugin(plugin, data)` adds the debug layers of a dev plugin (`defineDevPlugin` of `devLayers.ts`): the
plugin core calls it in its constructor, and `data` gives the data of its layers at each draw.

The frame memory of the plugin goes through `saveMemory` and `restoreMemory` of the scene core. A mixin class has a
constructor with one rest parameter: a plugin core can declare a constructor that types its options.

## Files

| File                                                    | What it holds                                                                                                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/devCore.ts`                                        | `withDevCore`: the frame mark, the debug layers, the inspect report, the tune values, the clock stop, the sweep, the pictures of the frame index, the onion pass, the split of the statistics                  |
| `src/layersCore.ts`                                     | `withLayers`: the selection outline, the previews, the scratch props, the ghosts, the editor overlay, the onion layer, the hide of the panes, the pick of a pane and the captures without the views of the lab |
| `src/panesCore.ts`, `src/panes.ts`                      | `withPanes`: the split screen (1 to 4 panes after one update, a scene per pane with its own tune values); the layouts as plain math for the page                                                               |
| `src/client.ts`                                         | The lab methods of a renderer (`DevMethods`): on the dev core of the main thread or as messages to the dev worker (`withDevMethods`, `devInit`)                                                                |
| `src/worker/protocol.ts`, `src/worker/extension.ts`     | The lab messages (`DevToWorker`, `DevFromWorker`, `DevInit`) and their handler (`handleDevMessage`, `devCoreOptions`)                                                                                          |
| `src/inspect.ts`, `src/joints.ts`                       | The generic inspect report, the debug layer names, the joints of a figure                                                                                                                                      |
| `src/metrics.ts`                                        | The generic motion metrics (`ik.reachError`, `feet.belowFloor`, `members.overlap`, `joints.*`) as parts that a plugin puts in its order                                                                        |
| `src/debugLayers.ts`, `src/devLayers.ts`                | The debug layers from plain shapes (`DebugInput`): the generic drawers (obstacles, paths, skeleton) and the layer face of a dev plugin (`defineDevPlugin`, `GENERIC_LAYERS`, the draw order)                   |
| `src/document/*`                                        | The dev document core (`DevDocumentCore`), its inspect report (`inspectScene`), its layers (bounds, sockets, skeleton, wireframe, normals, lights, cameras), the dev scene worker and the dev document client  |
| `src/pick.ts`, `src/pickMath.ts`, `src/pickKinds.ts`    | The pick framework: the ray on the scene graph and the capsules of the figures; the open `PickKind` and the classifiers that a plugin registers (`registerPickClassifier`)                                     |
| `src/selection.ts`, `src/skinBounds.ts`, `posedMesh.ts` | The selection outline; the bound and the posed copy of a skinned mesh for the pick                                                                                                                             |
| `src/preview*.ts`, `src/scratch.ts`                     | The import previews and their loaders (`./previewLoad`), the scratch props                                                                                                                                     |
| `src/ghosts.ts`, `src/overlay.ts`, `src/onion.ts`       | The ghosts of the proposals, the editor overlay, the onion skin                                                                                                                                                |
| `src/hiding.ts`, `src/hideSpec.ts`                      | Solo and hide per pane                                                                                                                                                                                         |
| `src/shots.ts`, `src/sweep.ts`, `src/readback.ts`       | The requests of index pictures, the sweep samples and the comparison of reports, the capture check of a backend                                                                                                |
| `src/timedPlaces.ts`, `src/tune.ts`, `src/heap.ts`      | The timed prop places of a take, the tune API over the registry of `@scenity/scene/tuning`, the heap of the thread                                                                                             |
| `src/layoutTools/*`                                     | The generic layout tools (`runLayoutTool`): measure, reach spheres, clearance, walk paths and visibility on a metric context of `@scenity/rules`, with the readout and the overlay shapes                      |

## Pick kinds

The framework knows the kinds `prop` (`prop-<slot>`), `scratch`, `member` (`member:<id>`, `person:<id>`) and `room`.
A plugin registers a `PickClassifier` for its own kinds: the item of a node name, the kinds whose pick names a bone, the
graybox object of a prop slot and the object of an outline. The pick of the core and the selection text of the page read
the same list, so the plugin registers it in a module that both import.

Tests: `bun test ./packages/runtime-dev` (from the repo root). The tests of the dev core over the core of a plugin are
in the dev extension of the plugin.
