# @scenity/tokens

The design tokens of Scenity: DTCG 2025.10 sources and the Style
Dictionary build. The CSS variables start with `--sc-`.

## Themes

Three themes, each with a high-contrast form (`data-contrast="more"`): `navy` (dim navy surfaces; the editor and the
workbench set `data-theme="navy"`), `light` (the default when the root has no `data-theme`) and `dark`. The engine
tokens are neutral: surfaces, text, borders, accent, focus, status colors, type roles, space, radii, motion. The tokens
of a domain are a plugin set.

## File map

| To change                                                  | Edit                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| A primitive (palette, font, space, radius, motion)         | `src/primitives/*.tokens.json`                                             |
| A semantic token of a theme                                | `src/themes/<theme>.tokens.json`, `<theme>-high-contrast.tokens.json`      |
| A token of every theme (type roles, durations)             | `src/themes/base.tokens.json`                                              |
| The sizes of the studio (dense editor, comfortable Hub)    | `src/components/studio.tokens.json` (`--sc-studio-*`)                      |
| The colour roles of the studio (selection, agents, axes …) | `color.studio` of `src/themes/<theme>.tokens.json` (`--sc-color-studio-*`) |
| The contrast pairs                                         | `src/checks.ts`                                                            |
| The build, the token sets, the outputs                     | `config/build.ts`, `config/formats.ts`, `config/formatsNative.ts`          |

## Build

`bun run build` in this folder (or `bun run generate` from the repo root) writes `dist/`: `tokens.css`,
`tailwind.css`, `tokens.ts`, `reference.json` and the Android and Unreal files.

A plugin builds its own set with `pluginSet()` and `build()` of `@scenity/tokens/build`: the engine sources and the
plugin sources resolve together, and the CSS outputs of the plugin hold only the plugin tokens. The app imports the
plugin CSS after the engine CSS.

## The token page

`tokens.html` of the scene dev server of `apps/editor` (`bunx --bun vite --config vite.scene.config.ts` there) shows
the studio tokens in the six variants with their checks.

## Tests

`bun test ./packages/tokens` from the repo root: the outputs (and that `dist/` is up to date) and the contrast checks.
