# Scenity Studio: the UI plan

Status: **accepted by the owner on 2026-10-17** (the answers are in [plan.md](plan.md) §9). Nothing in this folder is
built yet.

Scenity Studio (the studio) is one application for everything that Scenity can do. It starts with no project (the
Hub), makes or opens a project, and edits it in an editor window with docked panels, as in Unity. Agents are part of
the design from the first day: the person and the agent use the same commands, the agent's edits wait for review
where the person works, and any agent can connect over MCP.

## The documents

Read them in this order:

| Document                             | Read it to                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| [vision.md](vision.md)               | See the problem of today, the aim, the principles, the references, the journeys and targets |
| [coverage.md](coverage.md)           | Find each feature of Scenity, where it is today and where it goes in the studio             |
| [shell.md](shell.md)                 | See the Hub, the editor window, the panels, menus, toolbar, keys and interaction rules      |
| [agents.md](agents.md)               | See how agents work in the studio: sessions, context, change sets, review, trust, tools     |
| [design-system.md](design-system.md) | See the density, colours, icons, components, writing and accessibility rules                |
| [extensibility.md](extensibility.md) | See how a plugin adds panels, widgets, menus, tools and agent tools                         |
| [architecture.md](architecture.md)   | See the processes, where state lives, the protocol, security, speed, tests and migration    |
| [plan.md](plan.md)                   | Find the phases, the 186 tasks, the milestones, the risks and the owner's decisions         |
| [checklist.md](checklist.md)         | Track the work: one line per task, and the progress log                                     |

The owner answered the questions of [plan.md](plan.md) §9 on 2026-10-17 (task UI0-01). Three decision records follow:
`docs/adr/05-studio-process.md`, `06-agent-interaction.md` and `07-studio-extensions.md` (UI0-02 to UI0-04).

## How to work with the plan

- A task ID is `UI<phase>-<nn>`. A commit or a change note names the task.
- A task is done when the definition of done of [plan.md](plan.md) §3.2 holds: it works by mouse and keyboard, it is a
  command with an agent tool, a plugin can extend it (where it is an extension point), its texts are in Fluent, it
  works in every theme, it has tests, it keeps the speed budgets, and the docs say how to use it.
- Tick the task in [checklist.md](checklist.md) and add an entry to its progress log.
- A design change goes into the design document first, then into the tasks.

## Words

| Word          | Meaning                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Studio        | The whole application: the host, the Hub and the editor windows                                             |
| Host          | The Bun process behind the studio: projects, documents, jobs, agents, files, Git (the workbench host grown) |
| Hub           | The start page with no project: projects, new project, learn, agents, settings                              |
| Editor window | The page of one open project, with the menu bar, toolbar, dock and status bar                               |
| Panel         | A part of the editor window that docks, tabs and floats (Hierarchy, Inspector, Agent …)                     |
| Overlay       | A small panel over the Scene view that docks to its edges and folds (Tools, View options …)                 |
| Workspace     | A named layout for a task: Layout, Animate, Assets, Review, Build                                           |
| Command       | One action with a label, keys, an args schema and an actor; every edit is one                               |
| Actor         | Who runs a command: the person, an agent session, a script or a plugin                                      |
| Job           | A long task of the host with progress and outputs, for example a `scenity` command                          |
| Session       | One conversation of one agent with the studio, with its mode, budget and colour                             |
| Turn          | One prompt and all the work of the agent until it stops                                                     |
| Change set    | The document edits of one turn, as one override layer that waits for review                                 |
| Proposal      | One edit of a change set (the word of today's editor)                                                       |
| Checkpoint    | The state of documents and files at the start of a turn; a restore goes back to it                          |
| Mode          | The permission mode of a session: Ask, Review or Auto                                                       |
| Task          | Agent work that runs in the background or in parallel                                                       |
| Recipe        | A saved prompt with parameters that runs as a command                                                       |
| Note          | A pin on an entity or a point; it can go to an agent as a task                                              |
| Studio face   | The part of a plugin that adds to the studio UI (`scenity.studio`)                                          |
| Contribution  | One thing that a studio face adds: a panel, a widget, a menu item, a tool …                                 |
| Shadow view   | The hidden view where agents and the frame index draw, so the person's view never moves                     |

The words of Scenity itself (project, entity, component, sequence, rule, op, override layer …) are in
[docs/README.md](../README.md).
