# Scenity documentation

Scenity is a 3D scene engine for the web: JSON scene documents, a runtime on three.js (WebGPU or WebGL, in a worker),
plugins, an editor, a player, the `scenity` command and Scenity Studio, where you work on projects with agents.

## Start here

| Page                                   | Read it to                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| [quickstart.md](quickstart.md)         | Make a project, add a model, a light and a camera, save, check, build and take a picture |
| [studio.md](studio.md)                 | Use Scenity Studio: the Hub, the editor window, agents, jobs, version control, trust     |
| [editor.md](editor.md)                 | Use the editor: scenes, hierarchy, inspector, gizmos, assets, prefabs, sequencer, play   |
| [cli.md](cli.md)                       | Use each `scenity` command, and install the command from a checkout or from npm          |
| [formats.md](formats.md)               | Read and write the files: project, scene, prefab, sequence, rules, assets; JSON Schemas  |
| [plugins.md](plugins.md)               | Write a plugin: components, presenters, systems, simulations, metrics, tools, commands   |
| [studio-plugins.md](studio-plugins.md) | The studio face of a plugin: a guide to each point of the editor window, with examples   |
| [lab-to-studio.md](lab-to-studio.md)   | Move the lab face of a plugin (`EditorPlugin`) to the studio, part by part               |
| [workbench.md](workbench.md)           | The workbench page of older versions, which retires (its parts are in the studio)        |
| [architecture.md](architecture.md)     | Learn how the packages, the runtime, the editor, the player and the build fit together   |

## For contributors to this repository

| Page                                                       | What it holds                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [testing.md](testing.md)                                   | The test layers, where each test lives, the fixture rule, the GPU lock, baselines |
| [adr/01-package-map.md](adr/01-package-map.md)             | The packages and the layer rules                                                  |
| [adr/02-scene-model.md](adr/02-scene-model.md)             | The scene model: entities, components, IDs, units, references                     |
| [adr/03-asset-identity.md](adr/03-asset-identity.md)       | Asset records, IDs, the manifest and rights                                       |
| [adr/04-time-model.md](adr/04-time-model.md)               | Time, sequences, simulations, systems and determinism                             |
| [adr/05-studio-process.md](adr/05-studio-process.md)       | The studio host, one origin, one scene server, the documents in the host          |
| [adr/06-agent-interaction.md](adr/06-agent-interaction.md) | Actors, sessions, turns, change sets, checkpoints, modes, presence                |
| [adr/07-studio-extensions.md](adr/07-studio-extensions.md) | The studio face of a plugin and its contribution points                           |
| [generic-engine-plan.md](generic-engine-plan.md)           | The plan of the generic engine and the record of each task                        |
| [ui/](ui/README.md)                                        | The plan of Scenity Studio: the Hub, the editor window, agents first, extensions  |

Each package has a README with its file map ("to change X, edit Y"): start at `packages/<name>/README.md` or
`apps/<name>/README.md`. The root [README](../README.md) has the build and test commands of the checkout.

## Claude Code

The skill `.claude/skills/scenity/SKILL.md` gives Claude Code the commands, tools and rules of this repository. The
resus room of CodeBlue, the first user of the engine, lives in the CodeBlue repository with its own skill
(`.claude/skills/resus` there).

## Words

| Word           | Meaning                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| Project        | A folder with `scenity.project.json`: scenes, sequences, assets, plugins, rules               |
| Entity         | One item of a scene, with an ID, a parent, a name, tags and components                        |
| Component      | Typed data on an entity (`transform`, `light`, `demo.spin`); a schema gives its fields        |
| Presenter      | The code that turns a component into three.js objects                                         |
| System         | Plugin code that runs in fixed steps and writes transforms and values                         |
| Simulation     | Plugin code that gives the meaning of the action keys of a sequence                           |
| Sequence       | Tracks and keys over time for one scene                                                       |
| Rule           | A limit on a metric (a distance, an overlap, a reach) that `scenity check` and the save check |
| Op             | One edit of a document; every op has an inverse                                               |
| Override layer | A list of ops on top of a scene: a variant, a proposal                                        |
| Change set     | The edits of an agent turn that wait for review in the Review mode                            |
| Workspace      | A layout of the dock of the editor window for one kind of work (Layout, Animate, Build)       |
| Proposal       | An edit from Claude that waits for the owner                                                  |
