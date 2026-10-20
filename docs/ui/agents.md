# Scenity Studio: agents first

This page gives the design of the agent parts of the studio. ADR 06 (UI0-03) records the decisions; the tasks are in
phase UI5 of [plan.md](plan.md), with parts in UI2, UI4, UI7, UI8 and UI14.

## 1. What "agent first" means here

1. **Same verbs.** A person and an agent do the same things with the same commands. There is no feature that only
   one of them can use (principle A1).
2. **The agent works where the person works.** The agent panel is a dock panel of the editor window; the agent's edits
   show in the Scene view, the hierarchy, the inspector, the timeline and the Project window.
3. **The person stays in control.** Each turn is one change set that waits for review (by default), one undo step and
   one checkpoint. The mode of each session is always on screen.
4. **The person's view is theirs.** The agent looks through its own view and never moves the person's camera, clock,
   selection or focus.
5. **Any agent.** The built-in Claude session and an external agent (Claude Code, Codex, Cursor, Claude Desktop) use
   the same tools and get the same review.
6. **No agent is fine.** Every feature works with no agent; the agent saves time, it is never the only way.

## 2. The model

```text
person ─┐                                   ┌─► change set (override layer of documents) ─┐
        ├─► session ─► turn ─► tool calls ──┤                                             ├─► review ─► accept / reject
agent  ─┘   (actor,     (one     (commands, └─► file edits (snapshots of the host) ───────┘           (one undo step)
             mode,       prompt)  jobs, UI)                                                   checkpoint at each prompt
             budget)
```

| Word        | Meaning                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| Actor       | Who runs a command: the person, an agent session, a script or a plugin. The history and the activity log keep it (UI4-04) |
| Session     | One conversation of one agent with the studio, with its mode, model, budget and colour                                    |
| Turn        | One prompt of the person and all the work of the agent until it stops                                                     |
| Change set  | The document ops of one turn, as one override layer (`scenity.overrides/1`) with a title and a summary                    |
| Proposal    | One op of a change set that waits (the word of today's editor)                                                            |
| Turn record | The change set, the file snapshots, the runs, the frames and the checks of one turn (UI5-05)                              |
| Checkpoint  | The state of the documents and the files at the start of a turn; a restore goes back to it (UI5-06)                       |
| Task        | A turn or a chain of turns that runs in the background, alone or in parallel with others (UI5-19)                         |

**Today and after.** Today a proposal is one command with a card in the frame, sequence edits have no proposals, the
editor history and the host turns do not know each other, and the switch to apply at once has no UI. After UI5, a
change set holds all the ops of a turn (scene, prefabs, materials, sequence, project settings), one turn record holds
the files too, and one action ("Undo the turn") reverts both.

## 3. The agent panel

```text
┌ Agent ──────────────────────────────────────────────── ⋯ ┐
│ [● Lobby lights] [● Chairs] [+]                          │
│──────────────────────────────────────────────────────────│
│ ▸ Checkpoint · 14:02                         Restore     │
│ You: add four chairs around the table and light it warmer│
│ ┌ Plan ─────────────────────────────────── 3/4 ✓ ┐       │
│ │ ✓ Find the table and the free space            │       │
│ │ ✓ Add four chairs (prefab chair)               │       │
│ │ ✓ Turn them to face the table                  │       │
│ │ ◌ Warm the key light                            │       │
│ └────────────────────────────────────────────────┘       │
│ ┌ Added 4 entities ─────────────── [frame] Show ┐        │
│ │ chair-n, chair-e, chair-s, chair-w             │        │
│ └────────────────────────────────────────────────┘       │
│ ┌ Set Key light ▸ light ▸ colour  #fff4e0 → #ffd9a8 ┐    │
│ └────────────────────────────────────────────────────┘    │
│ Change set: 5 changes wait  [ Review ] [ Accept all ]     │
│──────────────────────────────────────────────────────────│
│ [Lobby] [Table ×] [t=0 s] [Scene view]            ＋ ⧉    │
│ Ask about the selection, @ to mention, / for recipes     │
│                                                          │
│ Review ▾   Claude Opus · high ▾   $0.42 · 18 % context ▢ │
└──────────────────────────────────────────────────────────┘
```

| Part           | What it does                                                                                                       | Task           |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | -------------- |
| Session tabs   | One tab per session in its colour; ⌘T a new one; a dot when it waits for the person; ⋯ rename, fork, close, export | UI5-01         |
| Transcript     | The person's prompts, the agent's text, cards for tool calls, plans, questions, approvals, checkpoints             | UI5-03         |
| Cards          | A tool call as a sentence ("Set Key light ▸ colour"), its target, its pictures, a fold with the raw call           | UI5-03         |
| Change set bar | The count of changes that wait, Review, Accept all, Reject all                                                     | UI5-04         |
| Chips          | The context that goes with the prompt; ✕ removes one; ＋ adds files, pictures or a region of the view              | UI5-02         |
| Composer       | `@` mentions, `/` recipes, ↑ the last prompts, ⌘↩ send, ⌘. stop; a prompt sent during a turn waits in a queue      | UI5-01         |
| Footer         | The mode (Ask, Review, Auto), the model and effort, the cost of the session and the share of the context used      | UI5-07, UI5-17 |

## 4. Where a person can ask

| Place                           | How                                           | The context it adds                                | Task    |
| ------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------- |
| The agent panel                 | ⌘L, then type                                 | The chips of §5                                    | UI5-01  |
| The search box                  | ⌘K, a sentence, ⌘↩                            | The selection and the open panel                   | UI3-07  |
| The Scene view                  | ⌘I on the selection, or ⌘I then click a point | The entities, the point, a crop of the view        | UI5-10  |
| An inspector field or component | ⌘I or "Ask the agent" in the ⋯ menu           | The entity, the component, the field and its value | UI5-10  |
| A hierarchy row, an asset tile  | ⌘I or the context menu                        | The entity or the asset                            | UI5-10  |
| A timeline range                | Select a range, ⌘I                            | The sequence, the tracks and the time range        | UI5-10  |
| A problem                       | "Ask the agent to fix" in Problems            | The problem, its entities and its rule             | UI6-09  |
| A note                          | "Send to the agent" on a note pin             | The note, its target, its author                   | UI5-14  |
| An empty panel                  | The suggestion in its empty state             | The panel and the project                          | UI14-04 |
| The Hub                         | "What do you want to make?"                   | The templates and the samples                      | UI2-04  |
| A recipe                        | The search box, a menu or `/`                 | The recipe parameters and the selection            | UI5-13  |

The inline prompt (⌘I) opens a small field at the place. Its result is a change set in place: ghosts in the view and
marks on the fields, with Accept and Reject beside the field. The full transcript goes to the session of the place
(the active session, or a new one named after the subject).

## 5. Context

**What the agent gets at the start of each turn** (the context packet, extended from today's `context.ts`):

- the chips of the composer (the person sees them, §3);
- `studio_state` (UI4-09): the project, the open scene, the selection, the top entities, the prefabs, the sequences,
  the open problems, the agent mode, the workspace and the time;
- the project instructions (`AGENTS.md`, and `CLAUDE.md` if there is one) and the skills of the project (UI5-12);
- the result of its last change set: what the person accepted, rejected or changed after it ("The person rejected the
  second lamp");
- the notes sent to it (UI5-14).

**What the person sees**: the same chips, and a "Context" fold at the top of each turn in the transcript that lists
what went in. No context goes to an agent without a visible chip or a line in that fold.

**Mentions.** `@` opens a list of entities, assets, files, rules, sequences, commands and notes. A mention is a chip
with a stable reference (`entity:<id>`, `asset:<id>`, a path). A drag of any item into the composer makes the same
chip (shell.md §9.2).

## 6. Change sets and review

### 6.1 The life cycle

```text
 draft ───────────────► waiting ──────────────► accepted (all)      one undo step "Agent: <title>"
 (the turn runs; ghosts   (the turn ended;   ├──► partly accepted   the accepted ops as one step; the rest go
  show "in progress")      Review shows it)   │                      to the agent as feedback
                                             ├──► rejected          nothing changes; feedback to the agent
                                             └──► stale             the base changed a lot; "Ask the agent to redo"
 Auto mode: draft ──► applied (one undo step per turn) ──► the Review panel lists it with Undo
```

- A change set is an override layer over the base documents. The views draw the base with the layer as ghosts; the
  person can switch the layer on to see the result in full ("Preview") and off to compare.
- **Conflicts.** When the person edits a value that a waiting op also sets, the op gets a conflict mark. The default
  keeps the person's value; the Review row offers "Use the agent's value". An op on a deleted entity becomes stale.
- **Granularity.** Accept or reject the whole change set, all ops of one entity, or one op. Each accept is one undo
  step.
- **Feedback.** The result of the review goes into the next context of the session (§5), so the agent learns what the
  person did not want.

### 6.2 Marks in place

| Place          | Mark                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Scene view     | Added entities as ghosts in the agent colour; moved entities with a ghost at the new place and a line                |
|                | from the old one; removed entities with a dashed outline; "in progress" outlines during the draft                    |
| Hierarchy      | A dot in the agent colour on each changed row; added rows in italic; removed rows struck out                         |
| Inspector      | A changed field in the agent colour with the old value on hover and ✓ ✕ beside it; a changed component header marked |
| Timeline       | Added or moved keys as hollow keys in the agent colour                                                               |
| Project window | A mark on new and changed files and assets                                                                           |
| Status bar     | "5 changes wait" (a click opens Review)                                                                              |

### 6.3 The Review panel

```text
┌ Review ─────────────────────────────────────────────────────────────────────────────── ⋯ ┐
│ ● Chairs · turn 3 · "Add four chairs around the table and light it warmer"   14:06       │
│ [ Preview ●on ]  [ Before | After ] wipe ▸         Rules: ✓ 6  ⚠ 1 (was ✓)               │
│──────────────────────────────────────────────────────────────────────────────────────────│
│ ▾ ＋ chair-n   prefab chair at (0, 0, 1.1)                                      ✓  ✕     │
│ ▾ ＋ chair-e   prefab chair at (1.1, 0, 0)                                      ✓  ✕     │
│ ▸ ＋ chair-s                                                                    ✓  ✕     │
│ ▸ ＋ chair-w   ⚠ overlaps the sofa (rule noOverlap)                             ✓  ✕     │
│ ▾ ~ Key light  light ▸ colour   #fff4e0 → #ffd9a8                               ✓  ✕     │
│ ▸ Files: plugins/demo/src/spin.ts (+12 −3)                                      diff     │
│──────────────────────────────────────────────────────────────────────────────────────────│
│ [ Reject all ]                                     [ Accept 4 checked ]  [ Accept all ] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- A row selects its entity in the views; ⏎ accepts, ⌫ rejects, ↑ ↓ move.
- The rules line runs the rule check on the result and names each rule that changes state.
- **Before and After** pictures come from the shadow view (UI4-08), with a wipe.
- The file rows open the diff (code) or the semantic diff (documents, UI12-05).

## 7. Turns, checkpoints and undo

- **One history.** Accepted change sets are steps of the one undo history of the scene, with the session as the actor.
  Undo and redo work on them as on the person's steps.
- **Undo the turn** (UI5-05) reverts the whole turn: its accepted ops (by their inverse ops) and its file edits (from
  the host snapshots). It is one step; redo brings it back.
- **Checkpoints** (UI5-06): a line in the transcript at each prompt. **Preview** shows a frame and the diff to now;
  **Restore** puts back the documents and files of that time and keeps the conversation. A restore is one step that
  undo can revert.
- **Turns of an external agent** are the same: the host makes a turn record from the first tool call of a session
  after a pause of the person's prompts (external agents have no "prompt" event).

## 8. Permissions and trust

| Mode             | Document edits                        | File writes in the project               | Runs and jobs                              | Imports and downloads             | Git                |
| ---------------- | ------------------------------------- | ---------------------------------------- | ------------------------------------------ | --------------------------------- | ------------------ |
| Ask              | None (reads, plans and answers only)  | None                                     | Reads only (check, shot, sheet)            | None                              | None               |
| Review (default) | Change sets wait for review           | An approval card with the diff per write | Runs with `agent: true`; others ask        | Ask, with the rights record shown | Never (owner only) |
| Auto             | Apply at once, one undo step per turn | Allowed, except the denylist             | Runs with `agent: true` and read-only jobs | Allowed with a rights record      | Never (owner only) |

- **Per kind** (scene edits, file writes, runs, imports, network, Git): Allow, Ask or Deny in Preferences → Agents and
  per project in Project settings → Agents and runs. The stricter value wins (UI5-07).
- **Always ask**, in every mode: a file delete; a write outside the project; a change of the `plugins` list or of a
  plugin's package.json (it runs code); a package install; a shell command outside the run list; a download over
  50 MB; the switch of a session to Auto.
- **Roles** cap the modes: a viewer has none, an editor has Ask and Review, an admin has all three. In remote mode no
  role has Auto for file writes.
- **Budgets.** Auto and background tasks need a budget (cost, turns and minutes; default $5, 200 turns, 30 minutes).
  The footer shows the use; at the limit the session stops and says why.
- **Mapping from today.** The chat modes of the workbench map so: "ask" → Ask, "edits" → Review, "all" → only for
  background tasks of an admin in their own worktree.

## 9. Presence and attention

- **Colour.** Each session gets a colour from a set of six that is never the selection colour (design-system.md §3).
  The tab, the cards, the marks and the ghosts use it.
- **In progress.** While a turn runs, the entities that it reads or edits get a thin outline in its colour and a dot
  in the hierarchy. With reduced motion the outline does not pulse.
- **The agent's camera.** When the agent takes a frame, its camera shows as a frustum in the Scene view for 3 s.
  "Follow the agent" (in the Agent overlay) makes a second view follow the agent's camera; the person's view never
  moves.
- **Status.** The status bar says what the agent does ("Claude: placing lamp (4/9)"); the title bar dot pulses while it
  works and shows a mark when it waits.
- **Attention.** When a turn ends or the agent waits, a toast and the bell say so; a system notification comes only if
  the window is not in front. The agent never takes the focus and never opens a dialog.

## 10. Plans and questions

- **Plan first** (UI5-08): for a large request (or always, if the person sets it), the agent writes a plan card:
  steps, the entities and files it will touch, the risks. Approve, Edit or Deny. The plan is saved in
  `.scenity/plans/<date>-<slug>.md`. During the run each step ticks; at the end a summary card lists what changed.
- **Questions** (UI5-11): the agent asks with a card of 2 to 4 choices and "Other"; the session waits with a dot on its
  tab and a toast.
- **Approvals** (UI5-07): a file write, a run or an import that needs approval shows a card with the diff or the
  command and Allow once, Allow for this session, Deny.

## 11. Tasks: background and parallel

| Kind            | What it is                                                                            | Isolation                                     | Task   |
| --------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- | ------ |
| Background task | A turn or a chain of turns that runs while the person works, with a budget and a gate | Its own change set; files in a worktree       | UI5-19 |
| Split work      | One request split over 2 to 6 agents, each with one part ("the chairs", "the lights") | One change set per agent; one merge at review | UI5-20 |
| Variants        | One request given to 2 to 6 agents (or models); each result is a variant of the scene | One override layer per variant                | UI5-20 |

- **The Tasks panel** lists each task: the prompt, the actor and colour, the state (running, waiting, done, failed),
  the change set, the budget used, the branch, the gate result. A search finds old tasks (today's experiment log).
- **The gate.** A background task ends only when its gate passes (the rules by default, `scenity check`; a project
  can name a run) or when its budget ends. A review pack (frames, sheets, the changes) is ready at the end (today's
  review pack).
- **Variants** show in a grid of frames from the same camera (the Variants panel, UI7-10). The person keeps one (its
  change set waits for review), keeps parts of two, or asks for more. As built (UI5-20): each variant is a background
  task with its own session, and its change set is the layer of the variant until the person keeps one (Keep accepts
  it and rejects the others). The grid is in the Tasks panel; "keep parts of two" is the Review panel on two sets.

## 12. Tools for agents

### 12.1 The catalogue

| Tool                                                 | What it does                                                                                   | Today                | Task             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------- | ---------------- |
| `studio_state`                                       | One small answer: project, scene, selection, top entities, prefabs, sequences, problems, mode  | New                  | UI4-09           |
| `scene_query`                                        | Entities by name, tag or component, with transforms, bounds and values                         | Yes                  | —                |
| `scene_commands`, `scene_command`                    | The command catalogue with JSON Schemas; a run of one command (a change set op in Review mode) | Yes (no schemas)     | UI4-05           |
| `scene_frame`, `scene_sheet`                         | Pictures and contact sheets from the shadow view                                               | Yes (moves the view) | UI4-08           |
| `scene_pick`, `scene_measure`                        | Pick at a point; distances and gaps                                                            | Yes                  | —                |
| `scene_check`                                        | The rules with their worst time, value and limit                                               | Yes                  | —                |
| `studio_console`                                     | The recent console lines and problems                                                          | New                  | UI6-08           |
| `changeset_state`                                    | The change sets of the session and what the person accepted or rejected                        | New                  | UI5-04           |
| `job_run`, `job_status`, `job_output`                | The `scenity` commands and the runs of the project as jobs                                     | `workbench_run`      | UI4-05           |
| `asset_search`, `asset_import`                       | The asset database; an import with a rights record                                             | Yes                  | UI9-01           |
| `asset_source_search`, `asset_source_import`         | Search and import from asset sources                                                           | New                  | UI9-10           |
| `index_frames`                                       | Frames of the frame index by sequence, camera and time                                         | `lab_*` only         | UI10-11          |
| `note_list`, `note_resolve`                          | The notes of a scene; link a change set and close a note                                       | New                  | UI5-14           |
| `ui_state`, `ui_reveal`, `ui_highlight`, `ui_notify` | Read the UI; show the person a thing; point at a control; send a toast                         | New                  | UI4-06           |
| Plugin tools                                         | The tools of host faces and the page tools of studio faces                                     | Yes (host faces)     | UI13-02, UI13-10 |

The old names stay as aliases for one phase (`workbench_run`, `workbench_after`). The core tools lose the lab words in
their names and texts ("take", "tune", "the 3D lab"); the `lab_*` tools move to the plugins that give a lab face.

### 12.2 Rules for tools

1. **One way in.** A tool that edits runs commands of the registry; it has no side door to the documents (UI4-01).
2. **All or none.** A tool call with many ops applies all of them or none, as one named step (UI4-10).
3. **Names.** The agent names each entity that it makes ("chair-n", "Key light"), never a bare `entity-2`.
4. **The person's view is theirs.** Frames come from the shadow view (UI4-08).
5. **Small answers.** IDs, names and what changed; pictures only on request; the change set ID and its review state.
6. **Errors that help.** An error names the valid values or the closest names, and how to fix the call.
7. **Place by relation.** "On", "against", "facing", "near" and "find an empty space", so agents do not overlap
   things (UI7-12).
8. **Check the work.** A frame after each part of a task; `scene_check` before the end (the stop gate).
9. **State first.** `studio_state` is the first call of a turn; the agent prompt says so.

## 13. External agents (MCP)

- **Connect** (UI5-15): Hub → Agents → "Connect an external agent" shows the setup for Claude Code, Codex, Cursor and
  Claude Desktop (a config line or a button that writes the config, as pen.dev does). `scenity mcp` is a stdio MCP
  server that finds the running host; the host also serves MCP over HTTP at `/mcp` with a client token.
- **Allow.** The first call of a new client shows a card: "Claude Code in ~/work/lobby wants to edit this project:
  Allow once · Always for this project · Deny". Preferences → Agents lists the clients with Revoke.
- **Presence.** An external client is a session with its own colour and a tab in the agent panel. The tab shows its
  tool calls as cards (the studio does not see its chat), its change sets and its mode. The person can change its mode
  or stop it.
- **The same rules.** External agents get the same modes, review, budgets (where the studio can count them) and tool
  rules.

## 14. Instructions, skills, recipes and notes

| Part         | Where it lives                                                | What the UI gives                                               | Task   |
| ------------ | ------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| Instructions | `AGENTS.md` at the project root (and `CLAUDE.md` if present)  | The Agent instructions panel; a line in each context fold       | UI5-12 |
| Skills       | `.claude/skills/<name>/SKILL.md` in the project               | A list in the instructions panel; `/` in the composer           | UI5-12 |
| Recipes      | `.scenity/recipes/<id>.md` (project), the user state, plugins | Commands in the search box and menus; a form for the parameters | UI5-13 |
| Notes        | `<scene>.notes.json` beside the scene (decision Q10)          | Pins in the views, the Notes panel, "Send to the agent"         | UI5-14 |
| Plans        | `.scenity/plans/<date>-<slug>.md`                             | Plan cards; the list in the Tasks panel                         | UI5-08 |

A recipe file has a title, parameters (name, kind, default), a prompt with the parameters in it, a mode and an
optional workspace. Example: "Light for a product shot" with the parameters `subject` (an entity) and `mood` (soft,
hard).

## 15. When things go wrong

| Case                          | What the person sees                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| The agent fails a tool call   | The card in red with the error and the agent's next step; nothing half applied (all or none) |
| The agent stops with an error | An error card with Retry and "Copy the details"                                              |
| No progress for 3 minutes     | A toast "The agent seems stuck" with Stop and Wait                                           |
| The budget ends               | The session stops; a card says which limit; Raise the limit (admin)                          |
| The host connection drops     | The banner of shell.md §13; the session goes on in the host and the panel catches up         |
| A change set goes stale       | The Review row says why; "Ask the agent to redo" sends the new state                         |
| No agent is connected         | Each entry point says "Connect an agent" with a link to Hub → Agents (UI5-18)                |

## 16. The agent as a teacher

- "How do I make a prefab?" in the search box or the agent panel gives a short answer with a **Show me** button.
- **Show me** runs the steps with `ui_highlight`: a callout points at each control in turn, and the person does the
  step (the agent does not click for them). The tutorials of UI14-02 use the same callouts.
- Each answer about the UI links the docs section (F1 help, UI14-03).

## 17. Measuring the agent experience

- **The benchmark** (UI0-06, UI14-09): 24 prompts over the samples: placement (6), lighting and look (4), sequences
  and animation (4), assets and import (3), rules and fixes (3), plugin code (2), project and build (2). Each has a
  check (a scene query or a rule). The scorer records success, time, cost, tool calls, review steps and the share of
  ops that a reviewer accepts.
- **Replays for CI.** A recorded transcript of tool calls replays with no model, so a change of a tool or a command
  that breaks an agent flow fails in CI.
- **The review time** of J9 in the usability studies: the time from the end of a turn to the last accept or reject.
