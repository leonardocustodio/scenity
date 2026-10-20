# @scenity/editor

The Scenity editor: the scene page with its edit mode, the player pages and the lab page of a plugin. The editor names no plugin: it loads the editor faces of the
plugins of its project.

## The package

`@scenity/editor` is a public package in the fixed release group of the engine packages. A project gets it from
`scenity create` and `scenity dev` starts its scene page dev server (`vite.scene.config.ts`) when the CLI runs with no
checkout. The tarball holds only what the scene page needs:

| Part                                                                       | What it is                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene.html`, `src/scene`, `src/studio/shell`                              | The scene page: the view of a scene document, the edit mode in the editor window of the studio (the dock with the Scene view, the hierarchy, the inspector, the project, the timeline, the rules, the material editor and the preferences) and the start screen of a project |
| `hub.html`, `src/hub`                                                      | The Hub of Scenity Studio: the projects, the new project wizard, Learn, Agents, Settings and the first run. The studio host serves it at `/`                                                                                                                                 |
| `player/play.html`, `src/player`                                           | The play window of the scene page (the `<scenity-player>` element with the documents of a handoff)                                                                                                                                                                           |
| `src/core`, `src/assetBrowser`, `src/i18n`, `src/texts.ts`                 | The editor core that the scene page shares with the lab page, the asset browser and the Fluent texts                                                                                                                                                                         |
| `vite.scene.config.ts`                                                     | The dev server config: the projects, the asset hot reload, the asset API, the scene save and the project plugins                                                                                                                                                             |
| `scripts/{projects,sceneProject,sceneSave,assetApi,assetApiServer}.ts`     | The dev server plugins of the projects, the scene list and the save, and the asset list and import of the asset browser                                                                                                                                                      |
| `scripts/{assetReload,assetsModule,labsCsp,labsFs,sceneProjectPlugins}.ts` | The asset hot reload (`@scenity/assets` on demand), the CSP header, the served folders and `virtual:scenity/project-plugins`                                                                                                                                                 |
| `scripts/scenityDeps.ts`                                                   | The Scenity packages that Vite reads as source, also from `node_modules` (`optimizeDeps.exclude`)                                                                                                                                                                            |

The published `exports` (`publishConfig.exports`, which `tools/release.ts` writes into the tarball) are `./studio`
(the extension API of the studio, `src/studio/extensions/api.ts`), `./core/*`, `./vite.scene.config` and
`./package.json`. The `exports` of the checkout also give the lab tools, the tests and the
Playwright configs (`./scripts/*`, `./tests/*`, `./playwright.config`, `./playwright.gallery.config`,
`./vite.config`) to a plugin workspace that links this checkout (CodeBlue). The lab page (`index.html`,
`vite.config.ts`, `src/main.ts`), the still page, the player pages of the samples, the tests and the lab tools of
`scripts/` stay in the checkout.

The config lists the samples of the checkout (`samples/*`) and their player pages only in a checkout. An installed
editor (a path under `node_modules`) serves the projects of `SCENITY_SCENE_PROJECTS` only: `scenity dev` gives it the
project that it opens.

## In the checkout

```sh
bunx --bun vite --config vite.scene.config.ts   # the scene page; then /scene.html?project=showroom
bun run dev                                     # the lab page (it needs a project plugin with an editor face)
bun run typecheck                               # vue-tsc, then the editor faces of the project plugins
bunx --bun vitest run                           # the unit and component tests
bun run test:gallery                            # the gallery of the samples (GPU; one run at a time)
```

The generated files `src/generated/editorPlugins.ts` and `editorStyles.css` hold the plugin list of the project of
the lab Vite config (`@scenity/cli/editor`). In the checkout they list no plugin; a project outside the checkout gets
its own files in `<project>/.scenity/editor`. The release pack fails when a module of the tarball imports a file out
of the package or a package that the manifest does not declare (`tools/release-imports.ts`).
