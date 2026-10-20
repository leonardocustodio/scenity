# Scenity Studio: the design system

This page gives the visual language and the parts of the studio UI. The tokens and components live in
`packages/tokens` and `packages/ui`; UI0-08 adds the tokens below and UI3-10 applies them to the editor.

## 1. What we build on

| Part              | Today                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@scenity/ui`     | Reka UI primitives and shadcn-vue components: accordion, alert, dialog, dropdown menu, combobox, popover, select, slider, switch, tabs, table, toggle, tooltip, toaster, sidebar, empty, kbd, breadcrumb, progress, skeleton and more; `src/a11y` (announcer, live regions, skip link, focus, motion) |
| `@scenity/tokens` | DTCG token files built by Style Dictionary into `--sc-*` CSS variables (284), Tailwind and TypeScript; themes `navy`, `light`, `dark` and their high-contrast forms (`data-contrast="more"`); `pluginSet()` for plugin tokens                                                                         |
| `@scenity/i18n`   | Fluent through fluent-vue; `en-US`, `pt-BR` and the pseudo-locale `en-XA`                                                                                                                                                                                                                             |
| Icons             | `lucide-vue-next`                                                                                                                                                                                                                                                                                     |
| Lint              | `no-raw-design-values`: no raw colours or pixel sizes in components                                                                                                                                                                                                                                   |

**Gaps today.** The scene page shell (bars, start screen, play bar, gizmo bar) uses hard-coded colours; the Vue panels
force `data-theme="dark"`; the lab page forces navy; the workbench page uses its own class helpers
(`apps/workbench/src/layout/ui.ts`) and no Fluent. The studio uses only `@scenity/ui`, tokens and Fluent.

## 2. Density

The editor is dense, as in Unity and Blender; the Hub and dialogs are comfortable. The sizes are the tokens of
`packages/tokens/src/components/studio.tokens.json` (UI0-08):

| Token (`--sc-studio-…`)            | Size         | Use                                      |
| ---------------------------------- | ------------ | ---------------------------------------- |
| `size-dense-row`                   | 24 px        | Tree rows, list rows, field rows         |
| `size-dense-control`               | 24 px        | Inputs, buttons, selects                 |
| `size-dense-control-small`         | 20 px        | Icon buttons in headers and rows         |
| `size-dense-panel-header`          | 28 px        | Panel headers and tab strips             |
| `size-dense-toolbar`               | 32 px        | The main toolbar                         |
| `size-dense-titlebar`              | 36 px        | The title bar of the editor              |
| `size-dense-statusbar`             | 22 px        | The status bar                           |
| `font-dense-body`                  | 12 px        | Body text of the editor                  |
| `font-dense-label`                 | 11 px        | Field labels, captions                   |
| `size-comfortable-row`, `-control` | 36 px        | Rows and controls of the Hub and dialogs |
| `size-comfortable-control-small`   | 28 px        | Icon buttons of the Hub and dialogs      |
| `size-comfortable-titlebar`        | 48 px        | The title bar of the Hub                 |
| `font-comfortable-body`, `-label`  | 14 px, 12 px | Text of the Hub and dialogs              |

The spacing scale is 2, 4, 6, 8, 12, 16, 24 and 32 px (`--sc-space-*`). A density setting (compact, comfortable) is a
could for later.

## 3. Colour roles

The themes give each role a value (`color.studio.*` in `packages/tokens/src/themes/<theme>.tokens.json`; the CSS
variables are `--sc-color-studio-…`). No component uses a raw colour. The token page (`tokens.html` of the scene dev
server) shows each role in the six variants with its checks.

| Role             | Tokens (`--sc-color-studio-…`)                           | Rule                                                                                          |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Surfaces, text   | `--sc-color-surface-*`, `--sc-color-text-*` (the engine) | Four surface steps, so docked panels, headers and fields read apart; text is AA on each       |
| Accent and focus | `--sc-color-accent-brand`, `--sc-color-focus-ring`       | One accent; the focus ring is 2 px with an offset                                             |
| Selection        | `selection`, `selection-subtle`                          | The accent: one colour for the selection in lists, the views (outline) and the timeline       |
| Play mode        | `play`                                                   | The frame of the views and the Play button during play (the orange of the status `attention`) |
| Prefabs          | `prefab`, `override-bar`                                 | Cyan: instance rows and icons, the prefab mode frame, the margin bar of an override           |
| Agents           | `agent-1` to `agent-6`                                   | Violet, lime, pink, peach (gold in light), near-white (slate in light), fuchsia               |
| Change marks     | `change-added`, `-changed`, `-removed`                   | The status colours, with the marks ＋, ~ and − (never colour alone)                           |
| Axes             | `axis-x`, `-y`, `-z`                                     | Red, green, blue in the gizmo, the vector fields, the orientation gizmo and labels            |
| Rule results     | `rule-ok`, `-fail`, `-known`, `-na`                      | The status colours, with the words ok, fail, known, n/a                                       |
| View overlays    | `overlay-surface`, `overlay-border`                      | Panels over the 3D view: a solid surface by default, a blur only where the GPU allows it      |
| Grid and helpers | `grid-minor`, `grid-major`, `helper`                     | Read on light and dark scene backgrounds                                                      |

**Checks** (`packages/tokens/src/checks.ts`). The selection, play, prefab, agent and axis colours pass 3:1 on each
surface (4.5:1 in the high-contrast variants). Each agent colour is apart from the other agents, the selection and the
prefab colour by an OKLab distance of 0.1 or more with normal vision. Six colours cannot also stay apart for every
colour-vision deficiency, so an agent mark always comes with its session name (the second cue).

The scene background is scene data (`environment.background`), not a theme value. The overlays stay legible on any
background.

## 4. Themes

- **dark** is the default of the editor (decision Q12); **light** and **navy** stay; each has a high-contrast form.
- The Hub follows the same theme.
- A plugin adds tokens for its own parts with `pluginSet()` and never changes a core token.

## 5. Type

- The UI font is the system UI stack (no web font to load). Numbers in fields and tables use tabular figures.
- A mono font for IDs, paths, code, values in diffs and the console.
- Sizes: 11, 12, 13, 15, 18 and 24 px. Panel titles 12 px semibold; Hub headings 24 px.

## 6. Icons

- Lucide for the UI, at 16 px in rows and headers and 20 px in the toolbar, stroke 1.5.
- A Scenity set on the same grid for the domain: each built-in component (transform, model, shape, the five light
  kinds, camera, socket, path, stand point, obstacle, note, prefab, animator, character, locomotion, audio), each asset
  kind and each track kind. They are SVG in `packages/ui/src/icons/scenity`.
- A plugin gives an icon per component, panel and command through its studio face (UI13-02); with none, the first
  letter of the label in a rounded square.
- An icon button always has a tooltip with its name and its keys.

## 7. Motion

- 120 to 200 ms for panels, menus and toasts; no motion over the 3D view except the ghosts and outlines of agents.
- With `prefers-reduced-motion`, nothing pulses or slides; the agent outlines stay still.

## 8. Components

### 8.1 The new components

| Component      | Use                                                                    | Built on               | Task            |
| -------------- | ---------------------------------------------------------------------- | ---------------------- | --------------- |
| `DockLayout`   | Dock areas, tab groups, splitters, floating panels                     | dockview (decision Q8) | UI3-02          |
| `Panel`        | Header (icon, title, lock, ⋯), body, empty state, error boundary       | `@scenity/ui`          | UI3-11          |
| `MenuBar`      | The menus from command metadata                                        | Reka menubar           | UI3-04          |
| `Toolbar`      | Groups of tool buttons and toggles                                     | Reka toolbar           | UI3-05          |
| `StatusBar`    | Items that open panels                                                 | —                      | UI3-06          |
| `CommandBox`   | Search and ask                                                         | Reka combobox          | UI3-07          |
| `TreeView`     | A virtual tree with drag, range select, rename in place, keys          | Reka tree              | UI6-05          |
| `PropertyGrid` | Field rows with labels that scrub, folds, marks (key, override, agent) | —                      | UI6-06          |
| `VectorField`  | X, Y, Z (and W) with axis colours and scrub                            | `NumberField`          | UI6-06          |
| `ColourField`  | Swatch, picker, hex, a pick from the view                              | Reka popover           | UI6-06          |
| `RefField`     | Asset, entity and socket references with a picker and a drop target    | Reka combobox          | UI6-06          |
| `CurveField`   | A small curve with an editor in a popover                              | canvas                 | UI8-02          |
| `TileGrid`     | Virtual grid of asset tiles with stills and marks                      | —                      | UI6-07          |
| `TimelineView` | Ruler, track rows, keys, markers, curves, a range                      | canvas and DOM         | UI8-01          |
| `Composer`     | Chips, mentions, slash recipes, attachments                            | —                      | UI5-01, UI5-02  |
| `ToolCard`     | A tool call as a readable card with a fold                             | —                      | UI5-03          |
| `ChangeMark`   | ＋ ~ − marks and the old value on hover, with ✓ ✕                      | —                      | UI5-04          |
| `SemanticDiff` | The diff of documents by entity and component                          | —                      | UI12-05         |
| `CodeDiff`     | The diff of a code file                                                | —                      | UI5-03, UI12-04 |
| `FrameCompare` | Two frames side by side or with a wipe                                 | —                      | UI5-04, UI11-03 |
| `JobList`      | Jobs with progress, logs and outputs                                   | `Progress`             | UI12-07         |
| `Banner`       | A state of the window across the dock                                  | `Alert`                | UI3-08          |
| `Callout`      | A pointer with text on a UI part (tour, tutorials, `ui_highlight`)     | Reka popover           | UI14-01, UI4-06 |
| `ViewOverlay`  | A panel over the 3D view that docks to an edge and folds               | —                      | UI6-01          |
| `KeyboardMap`  | The keyboard picture of the Shortcuts window                           | —                      | UI12-03         |
| `FolderDialog` | Folder browse through the host                                         | `Dialog`               | UI1-07          |

Each component has a component test, a page in the component gallery of `packages/ui` and works in the four themes.

### 8.2 Rules for components

- A component takes its texts from the caller (Fluent); it holds no English of its own.
- A component that lists many items (tree, grid, list, console) is virtual from the first version.
- A drop target says what it takes while a drag is on (shell.md §9.2).
- No component draws into the 3D canvas; overlays sit above it in the DOM.

## 9. Writing for the UI

- Sentence case; buttons and menu items start with a verb ("Add component", "Make a prefab"); panels are nouns.
- Buttons have at most three words. A tooltip has the name, then the keys, then one line of help.
- The same thing has the same word in every place; the words of [README.md](README.md) are the list.
- An error says what happened and what to do: "The model did not import: Blender is not installed. Install Blender
  5.2 or pick a .glb file."
- No lab words in generic UI ("take", "tune", "the 3D lab"); no claims about the agent ("smart", "magic"). The agent
  is named by its session name or its model.
- Every text is a Fluent message with an ID of the form `<panel>-<part>-<what>`; `tools/editor-texts.ts` finds text
  outside Fluent.

## 10. Accessibility

| Area           | Rule                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Contrast       | Text 4.5:1, UI parts and focus 3:1 in each theme; high-contrast themes 7:1 for text                                        |
| Colour         | Never the only signal: change marks, rule results, agent sessions and problems also have a mark or a word                  |
| Keyboard       | Each panel by keyboard; ⌃Tab moves between panels; roving focus in trees, grids and toolbars; Esc leaves a mode            |
| Screen readers | One landmark per panel with its title; names from Fluent; the live regions of `@scenity/ui` say job, save and agent events |
| The 3D view    | The hierarchy and the inspector are the text form of the scene; a selection change is said; gizmo values can be typed      |
| Motion         | `prefers-reduced-motion` stops pulses, slides and auto-moving cameras                                                      |
| Zoom           | The UI works at 200 % browser zoom (the docks fold, nothing is cut)                                                        |
| Checks         | axe in the component tests and on the 14 key screens (UI14-05); a keyboard-only e2e journey                                |
