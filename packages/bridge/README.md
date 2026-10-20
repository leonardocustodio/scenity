# @scenity/bridge

The one contract of the bridge between the workbench page (the parent) and a surface page in a frame (the editor):
the `postMessage` messages. The editor (the frame side), the workbench page
and the workbench host (the caller side) import it; none of them keeps a copy.

| File               | What it has                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/envelope.ts`  | `{ workbench: 1, id, call, args }`, the answers (`result` or `error`), the version, the URL parameter, the origin check, the transfer of picture bytes        |
| `src/define.ts`    | `defineBridgeCall` (a typed call: its name, the check of its arguments, the read of its result), `serveBridgeCall` (the frame), `sendBridgeCall` (the caller) |
| `src/base.ts`      | The base calls `url`, `capture` and `console`                                                                                                                 |
| `src/events.ts`    | The events: `ready`, `url`, `hmr`, `reload`, `console`, `key`, and the editor events of `editEvents.ts`, `assetEvents.ts`, `windowEvents.ts`                  |
| `src/keys.ts`      | The workbench chords that a frame sends with the event `key`                                                                                                  |
| `src/indexRead.ts` | The index reads of a frame through the workbench page (`workbenchIndex: 1`)                                                                                   |
| `tests/cases.ts`   | The shared case table (`@scenity/bridge/cases`): the editor, the workbench page and the host run it                                                           |

A plugin defines the typed calls of its script API methods with `defineBridgeCall` in its editor face and gives them
as `EditorPlugin.bridgeCalls`; its host face sends them with `callTyped` of the host tool kit. Both sides check the
arguments with the same definition. The cases of these calls are `PLUGIN_CALL_CASES` in
`plugins/<plugin>/editor/tests/bridgeCases.ts`.

The package is pure: no Vue, no Node API, no other workspace package (`tools/check-boundaries.ts`, ESLint, the
hygiene test). Only the two sides of the bridge, their plugin faces and the CLI depend on it.
