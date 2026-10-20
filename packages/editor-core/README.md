# @scenity/editor-core

The editor core of Scenity: the command kit, the runner, the edit ops, the history, the selection, the
proposals and the clipboard. No Vue: an editor page gives reactive cells (a Vue `ref` fits the `Cell` shape).

| File           | What it holds                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `command.ts`   | The command shape (generic over the state, the host and the op type), `defineCommand`, the argument check  |
| `registry.ts`  | `createCommandRegistry`: the commands of the editor and its plugins in the order of the palette            |
| `runner.ts`    | `createRunner`: owner, Claude and script runs; proposals, accept and reject; the switch of the session     |
| `ops.ts`       | The edit and its ops: `scene` ops (the patch model of `@scenity/scene`), `source` ops, `defineOpKind`      |
| `tunes.ts`     | The op kind of the tune values (`TUNE_OP`)                                                                 |
| `events.ts`    | The op kind of the events of a plugin (`eventOpKind`) and the restore of the events of edits               |
| `history.ts`   | `EditHistory`: one undo and redo for all edits over channels (the scene, the tune values, scratch, events) |
| `selection.ts` | The selection over entity IDs with sub-targets (`entity:<id>#<sub>`)                                       |
| `clipboard.ts` | Copy entities with their subtrees, paste them as `add` scene ops with new IDs                              |
| `hierarchy/`   | The entity tree, search, drop places, reparent (world transform kept), solo and lock, the commands         |
| `sequence/`    | The sequence ops and channel, the record mode (an edit at the clock time becomes a key), commands          |

The tests (`bun test ./packages/editor-core`) use a small generic scene (`tests/fixtures/garden.scene.json`). The
editor app (`apps/editor`) specializes the kit for the lab page, and a plugin (the room plugin of CodeBlue) registers its commands and its op
kinds through it (`EditorPlugin.registerCommands`, `EditorPlugin.ops`). The package can import only `@scenity/scene` and
`@scenity/labs-platform` (`docs/architecture.md`).
