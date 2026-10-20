// SPDX-License-Identifier: Apache-2.0
/**
 * The `sandbox` attribute of the lab frames: the surface frames (SurfaceFrame.vue) and the frame of the
 * indexer window (IndexerApp.vue). The list has only the tokens that the lab page needs in a frame of the workbench.
 *
 * - `allow-scripts`: the lab page is a Vue app. It runs module scripts and module workers (the render worker).
 * - `allow-same-origin`: the frame keeps the origin of the lab server. Without it, the origin is opaque: the browser
 *   storage, IndexedDB and the storage of the frame index throw, a module worker of the lab server does not load, and
 *   the bridge messages come from the origin "null", so the relay (relay.ts) and the bridge refuse them.
 * - `allow-forms`: the lab panels use `<form @submit.prevent>`. A sandbox without this token blocks the submission,
 *   and the `submit` event does not occur.
 *
 * Not in the list, because no feature of the lab page in the workbench needs them:
 *
 * - `allow-popups`: in the workbench, a detach sends the bridge event `detach`, and the workbench page opens the
 *   window. Only the lab page alone calls `window.open` (apps/editor `follow/detach.ts`, `graph/LabGraph.vue`).
 * - `allow-modals`: only the lab page alone asks with `confirm` (the cost of a pane window).
 * - `allow-top-navigation`, `allow-popups-to-escape-sandbox`, `allow-downloads`, `allow-pointer-lock`.
 *
 * `allow-scripts` with `allow-same-origin` lets a frame of the same origin as its parent remove its sandbox. The lab
 * server always has another origin than the workbench page: another port on 127.0.0.1, `tauri://localhost` for the
 * page of the app, and the gateway origin with its base path for the page of the remote mode. Thus the sandbox stays.
 * Fullscreen and the clipboard come from the `allow` attribute, not from the sandbox.
 */
export const LAB_FRAME_SANDBOX_TOKENS = ["allow-scripts", "allow-same-origin", "allow-forms"] as const;

/** The value of the `sandbox` attribute of a lab frame. */
export const LAB_FRAME_SANDBOX = LAB_FRAME_SANDBOX_TOKENS.join(" ");
