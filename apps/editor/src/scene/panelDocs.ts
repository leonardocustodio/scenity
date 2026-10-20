// SPDX-License-Identifier: Apache-2.0
/**
 * The docs of the editor window: the section of `docs/editor.md` of each panel ("The panels"), and the section of
 * `docs/components.md` of each built-in component (tools/component-docs.ts writes that page). F1 on a panel and the
 * docs button of a component card open them. A plugin gives its own links (the `docs` point of a studio face). A test
 * checks that each anchor is a heading of its page.
 */
import { DOCS_URL } from "./searchProviders";

/** The anchor of the section of each panel in `docs/editor.md`. */
export const PANEL_DOCS: Readonly<Record<string, string>> = {
  "scene.view": "scene-view",
  "game.view": "game-view",
  hierarchy: "hierarchy-panel",
  inspector: "inspector-panel",
  notes: "notes-panel",
  tags: "tags-panel",
  scenes: "scenes-panel",
  project: "project-panel",
  timeline: "timeline-panel",
  rules: "rules-panel",
  material: "material-panel",
  lighting: "lighting-panel",
  variants: "variants-panel",
  character: "character-panel",
  animator: "animator-panel",
  clips: "clips-panel",
  simulation: "simulation-panel",
  build: "build-panel",
  embed: "embed-panel",
  baselines: "baselines-panel",
  renderQueue: "render-queue-panel",
  frameIndex: "frame-index-panel",
  performance: "performance-panel",
  bench: "bench-panel",
  budgets: "budgets-panel",
  assetBuild: "asset-build-panel",
  rights: "rights-panel",
  approvals: "approvals-panel",
  release: "release-panel",
  export: "export-panel",
  activity: "activity-panel",
  console: "console-panel",
  problems: "problems-panel",
  search: "search-panel",
  history: "history-panel",
  review: "review-panel",
  plugins: "plugins-panel",
  jobs: "jobs-panel",
  vcs: "version-control-panel",
  instructions: "instructions-panel",
  tasks: "tasks-panel",
  terminal: "terminal-panel",
  agent: "agent-panel",
  projectSettings: "project-settings-panel",
  shortcuts: "shortcuts-panel",
  preferences: "preferences-panel",
};

/** The docs URL of a panel: its section of the editor page, else the page. */
export function panelDocsUrl(panel: string): string {
  const anchor = PANEL_DOCS[panel];
  return `${DOCS_URL}editor.md${anchor === undefined ? "" : `#${anchor}`}`;
}

/** The anchor of a component in `docs/components.md`: the GitHub slug of its ID. */
export function componentAnchor(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-");
}

/** The docs URL of a built-in component. */
export function componentDocsUrl(id: string): string {
  return `${DOCS_URL}components.md#${componentAnchor(id)}`;
}
