# @scenity/workbench

> **This page retires**: use Scenity Studio (`scenity studio`, [docs/studio.md](../../docs/studio.md)). The page
> continues to work for a short time.

The workbench page of Scenity: the surface frames of a checkout, the Claude panel, the before and after of a
turn, and the dock with the changes, the runs and the review. The page runs in a desktop shell (the labs app) and in
a browser. It speaks only to a host of `@scenity/workbench-host`. It is a developer tool; the learner release never
builds it.

The page imports only `@scenity/workbench-host/protocol` of the host (types and pure helpers). No package imports
this app. Its text is developer text.

## Run it

A desktop shell can embed the built page (`dist/`); this repository has no shell.

In a browser, from the repo root:

```sh
bun packages/workbench-host/src/main.ts --checkout "$PWD"   # prints WORKBENCH_READY {"origin":…,"token":…}
bun run dev:workbench                                            # Vite on 127.0.0.1, a free port
```

Then open `http://127.0.0.1:<page port>/?host=<origin>#token=<token>`. Without an endpoint the page tells how to start
a host.

## The layout

```text
┌ TopBar: checkout · branch · changed files · [lab] · host and server dots · Restart host ────────────────────────────┐
├ SurfaceStack (the frame of the tab in front; the shadow frame) ─┬ ClaudeColumn: ClaudePanel, BeforeAfter, Stop gate ┤
├ BottomBar: [Changes] [Runs] [Review] [Sessions] [Picker] · status line (the run in progress) ───────────────────────┤
└ DockPanels: the open dock tab ─────────────────────────────────────────────────────────────────────────────────────┘
```

A narrow window puts the Claude column under the surface. Without a host the page shows `HostMissing`; without an
open checkout it shows the start screen (`Checkouts`).

## The components by folder

| Folder      | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`      | `main.ts`, `Workbench.vue` (the page and its states), `styles.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `host/`     | `endpoint.ts` (the endpoint: the Tauri command `host_endpoint`, else `?host=` and `#token=`, kept in the session storage), `hostClient.ts` (the WebSocket client: `host.hello`, the request IDs, the events, a new attempt after 250 ms up to 8 s), `useHost.ts` (the client in Vue refs), `useHostRestart.ts` (`host.restart`), `menuEvents.ts` (the `workbench-menu` event of the shell, without `@tauri-apps/api`), `pictures.ts` (the pictures of the host by ID, `GET /pictures/<id>` with the token, as object URLs)                              |
| `surfaces/` | `SurfaceStack.vue` (one view per opened tab; the others stay loaded at 0 opacity), `SurfaceView.vue` (the frame, the shadow, the server state and its log), `SurfaceFrame.vue` (the `<iframe>`; the shadow is `visibility: hidden` in the viewport), `useSurface.ts`, `useSurfaceTabs.ts` (`surface.front`), `relay.ts`                                                                                                                                                                                                                                 |
| `claude/`   | `ClaudePanel.vue` (the tabs Claude, Shell and Chat), `Terminal.vue`, `useTerminal.ts`, `TerminalSessions.vue` (Resume, Export transcript), `xterm.ts` (xterm.js 6, loaded lazily), `BeforeAfter.vue`, `TurnSheets.vue` and `useTurnHistory.ts` (the saved turns and the sheets of the turn window), `useAgentLoop.ts`, `StopGateToggle.vue`, `notify.ts`; the chat (loaded lazily): `Chat.vue`, `ChatBar.vue`, `ChatStart.vue`, `ChatMessage.vue`, `ApprovalCard.vue`, `QuestionCard.vue`, `useChat.ts`, `transcript.ts`, `approval.ts`, `chatWords.ts` |
| `dock/`     | `DockPanels.vue`, `dockHost.ts`; Changes: `Changes.vue`, `DiffView.vue`, `diff.ts`, `useChanges.ts`, `TuneToCode.vue`; Runs: `Runs.vue`, `RunImages.vue`, `AssetRun.vue`, `useRuns.ts`, `runFile.ts`; Review: `Review.vue`, `markdown.ts`, `MarkdownView.ts`; Sessions: `SessionsTabs.vue`, `Sessions.vue`, `BackgroundRuns.vue`, `LoopStart.vue`, `LoopPack.vue`, `useLoops.ts`, `ExperimentLog.vue`, `CheckoutOptions.vue`; Picker: `Picker.vue`, `usePicker.ts`                                                                                      |
| `layout/`   | `TopBar.vue`, `BottomBar.vue`, `ClaudeColumn.vue`, `HostMissing.vue`, `ui.ts` (the shared classes), `workbenchKeys.ts`, `PictureImg.vue` (a picture of the host by ID)                                                                                                                                                                                                                                                                                                                                                                                  |
| `start/`    | `Checkouts.vue` (the worktrees; open one or make one from a branch), `newWindow.ts` (a window per checkout)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `panels/`   | `PanelApp.vue` (the page of a detached window, `?panel=<kind>`), `PanelLab.vue` (a lab frame with `follow=1`), `DetachCost.vue` (the cost dialog before the first pane detach, about 1 GB), `hostLink.ts` (the clock relay of the host), `openPanel.ts` (the shell command `open_panel`, else a browser window), `panelUrl.ts`, `useWindowLayout.ts` (the saved window layout per checkout)                                                                                                                                                             |

In the labs app the top bar also has **Close window** (`host/closeWindow.ts`): the page closes its own window
with the core command `plugin:window|close`, and the shell then stops the host of that window, its dev servers and
its terminals. A browser tab has no such button.

## Detached windows

"Open in a window" on the Claude column, a dock tab, the content browser or the metrics graph, and "Detach" on a pane
of the split screen, open that part in its own window: a native window of the labs app (`open_panel`,
`src-tauri/src/panels.rs`) or a browser window of this page with `?panel=<kind>`. The host relays the clock between
the windows (`packages/workbench-host/src/windowProtocol.ts`) and keeps the last clock state, so a new window starts
at the right time. A play, pause or seek in either window moves the other. The main window hides a detached part, and
"Dock back" puts it back. The host saves the window layout per checkout (`windowLayout.ts`): the Claude column, the
open dock tab and the place of each window. A restart opens the detached windows again at their places. A pane window
costs about 1 GB (a new WebKit content process and its GPU share).

## The host client

`hostClient.ts` opens `GET /ws?token=<token>` and sends `host.hello` with the page origin first. Each request has an
`id` and a time limit; the answer is `{ id, ok, result }` or `{ id, ok: false, error }`. An event has no `id`. The
client connects again after a loss, with a longer wait each time, and its state is `connecting`, `connected` or
`lost`. The host keeps the state (the transcript, the terminals, the runs, the surface URLs), so a reload of the page
loses nothing. A `Restart host` keeps the endpoint: the client connects again by itself.

## The access of the page

The host has no sign-in gate. `host.hello` gives these values (`useHost.ts` `accessOf`, the ref `access`):

- `project`: the surfaces, the runs and the theme of `scenity.project.json`. The tabs, their labels, their order, ⌘1
  to ⌘9 and the hidden surfaces come from the surfaces (`useSurfaceTabs.ts`). The page finds the scene surface by its
  capability (`relay.idWith`).
- `git`, the `role` of the token of the page (`viewer`, `editor`, `admin`), the auth provider and `remote`.

The page changes as follows:

- `git: false` (a project folder with no Git): the bottom bar has no Changes tab (`BottomBar.vue` `hidden`).
- `viewer`: no Claude column and no Claude toggle (a viewer cannot open a terminal or start an agent), no Restart
  host; the top bar shows the role.
- `editor`: the top bar shows the role; no Restart host.
- The theme of the manifest (`navy`, `light`, `dark`) goes to `data-theme` of the document.

The host refuses each request above the role anyway (`roleProtocol.ts` of the host); the page only hides the
controls.

## The relay

The host never speaks to a frame. For a tool call the host sends `surface.request`; `relay.ts` posts
`{ workbench: 1, id, call, args }` to the frame (target: the frame origin) and sends the answer back with
`surface.call`. Each bridge event of a frame (`ready`, `url`, `hmr`, `reload`, `console`) goes to the host with
`surface.report`; a `key` event stays in the page. The relay accepts a message only from the window of an attached
frame and with the origin of that frame. The frame `src` changes only when the dev server moves to another origin, so
a URL change inside the frame never loads it again. A lab frame URL gets `worker=1` from the host.

A picture answer of a frame (`capture`, `sheet`) has its bytes as an
`ArrayBuffer` that the bridge moved to the page. The relay sends the bytes as one binary WebSocket frame and then the
`surface.call` with the byte count (`splitPicture`, `HostClient.sendPicture`). The page shows every picture of the host
(the before and after, the sheets, the picker, the chat) by its ID through `PictureImg.vue`: no `data:` URL goes into
the DOM, and an object URL goes 30 s after its last view. The chat keeps its transcript in shallow reactive objects and
adds each message in place.

## The desktop fast path

In the labs app the page uses the shell for some tasks. In a browser, each task keeps its browser path. `src/desktop/`: `shell.ts` (the commands of the shell through the Tauri internals,
raw bytes, the features of `__SCENITY_SHELL__`), `localCalls.ts` (the relay answers the surface calls `snapshot`
and `clipMp4` itself; a browser answers `NO_NATIVE_…`), `snapshot.ts` (a native snapshot of the region
of a frame), `mp4Clip.ts` (the frames of a clip as JPEG to the MP4 writer of the shell), `framePace.ts` (the
frame pace of the lab for the indexer window, only while the indexer works). `src/indexer/` is the page of the indexer
window (`index.html?indexer=1`): `IndexerApp.vue`, `indexerPage.ts` (the host client and the relay of its lab frame,
the place `indexer`), `indexerLoop.ts` (one job at a time with `src/index/indexJobs.ts`), `pacer.ts` (the frame
cap, the yield to the main window, the pause on battery) and `frameSpec.ts` (the URL of the frame for the scene
options of a job).

## The keys

The lab in the frame owns Space, B, /, the arrows, comma, period, [ and ]. The workbench keys are ⌘ chords:

| Key      | Action                                                    |
| -------- | --------------------------------------------------------- |
| ⌘\       | Hide or show the Claude column                            |
| ⌘1 to ⌘9 | The tab at that place to the front                        |
| ⌘K       | The focus to the Claude prompt (the terminal or the chat) |

They come from the page itself (a Ctrl chord counts only outside a text field), from the native menu of the app in
any focus, and in a browser from the lab bridge while the lab frame has the focus (the bridge event `key`).
`layout/workbenchKeys.ts` maps all three.

## Tests

```sh
bun run test:components   # Vitest with happy-dom: tests/unit and tests/components (*.vitest.ts)
bun run typecheck         # vue-tsc
bun run build             # vue-tsc and the Vite build (the shell embeds dist/)
bun run e2e               # Playwright, Chromium, one worker
bun tests/perf/run.ts [--out <file.json>] [--idle <seconds>]   # the performance run
```

- The component tests use fakes of the host (`tests/components/fakeHost.ts`, `fakeDock.ts`, `fakeChat.ts`) and of the
  WebSocket (`tests/unit/fakeSocket.ts`).
- The specs that need the lab of a room are in the host face of the room plugin of CodeBlue
  (`bun run e2e:workbench` there, with the global setup of this folder and the project of that plugin):
  `bridge-shot.pw.ts` (a `lab_frame` capture through the host, the page and the bridge against `labs shot`),
  `edits.pw.ts`, `pick-ask.pw.ts`, `loop.pw.ts` (the recorded terminal session
  `fixtures/terminal-session.json` of this folder through `/hooks/` and `/tools/`), `chat.pw.ts`, `runs.pw.ts`,
  `panels.pw.ts` and `import-drop.pw.ts`. This folder keeps `scene-tools.spec.ts` (a host on a copy of the showroom).
- The e2e (`tests/e2e`) takes the GPU lock of the lab tools in `global-setup.ts` and starts the host in test mode
  (`packages/workbench-host/tests/e2e-host/main.ts`: the real host and the lab of the project, a scripted chat SDK, a
  plain shell in place of `claude`) and the page server. No test calls a model. Each run writes into its own
  `test-results/e2e-<time>` folder.
- The perf run measures the lab in the frame against the lab alone, the host CPU, the capture sizes and the tool
  times.
