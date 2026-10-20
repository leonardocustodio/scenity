# ADR 06: The agent interaction model

- Task: UI0-03 of `docs/ui/plan.md`
- Date: 2026-10-17
- Status: **accepted**. The owner chose Claude through the Agent SDK and any agent over MCP (Q4) and Review as the
  default mode (Q5). The design is in `docs/ui/agents.md`.

## Context

Today an edit of Claude is a proposal: one command, a card in the editor frame, Accept or Reject. Sequence edits get
no proposal. The switch to apply at once has no UI. The editor history and the host's turn snapshots (`turns.ts`) do
not know each other. `scene_frame` moves the person's camera and clock. The terminal, the chat and the background runs
each have their own safety rules. The studio needs one model for all agents (built in and external) that keeps the
person in control and fits the documents in the host (ADR 05).

## Decision

1. **Actors.** Every command run has an actor: `{ kind: "person" | "agent" | "script" | "plugin", id, name }`. An
   agent actor also has a colour index (1 to 6). The history step and the activity log keep the actor.
2. **Sessions.** A session is one agent conversation with the studio: the built-in Agent SDK session, a Claude Code
   terminal, a background task or an MCP client. It has an ID, an actor, a mode, a budget and a colour. The host owns
   the sessions.
3. **Turns.** A turn starts at a prompt of the person and ends when the agent stops. For an MCP client (no prompt
   event) a turn starts at its first tool call after 5 s with no call, and ends after 5 s with no call. The host makes
   a checkpoint at the start of each turn.
4. **Change sets.** The document ops of one turn on one document form one change set: an override layer
   (`scenity.overrides/1`) with `{ id, session, turn, title, summary, base }`, where `base` is the hash of each document
   at the start of the turn. A change set lives in the project session in the host. Its states: `draft` (the turn
   runs), `waiting` (the turn ended), `accepted`, `partial`, `rejected`, `stale`, and `applied` (Auto mode).
5. **Accept and reject.** Accept runs the command `changes.accept { changeSet, ops? }` as the person: the chosen ops
   apply to the base documents as **one undo step** whose label names the change set and whose actor is the agent
   session. Reject runs `changes.reject` and changes no document. The result of a review goes into the next context
   of the session as feedback.
6. **Conflicts.** When the person changes a value (a JSON Pointer) that a waiting op also sets, the op is marked
   `conflict`; the default keeps the person's value, and Accept of that op asks. An op on a removed entity, or a
   change set whose base hashes no longer match in the paths that it reads, is `stale`.
7. **Files.** File edits of a turn keep the host mechanism of today (snapshots at the prompt, `turns.ts`). The **turn
   record** joins the change sets, the file snapshots, the runs, the frames and the checks of a turn.
8. **Undo the turn.** One command reverts a turn: the inverse ops of its accepted change sets and the file snapshots,
   as one step that redo brings back.
9. **Checkpoints.** A checkpoint holds the document hashes and the file snapshot of the start of a turn, in the host
   state folder. Restore puts them back as one undo step and keeps the conversation. The host keeps 100 turns or 14
   days per project, whichever is more.
10. **Modes and permissions.** Each session has a mode: `ask`, `review` (the default) or `auto`. Each kind of action
    (scene edits, file writes, runs, imports, network, Git) has Allow, Ask or Deny in the person's preferences and in
    the project; the stricter value wins. The host tool layer is the one place that checks it, for every agent. The
    always-ask list and the role limits of `docs/ui/agents.md` §8 hold in every mode. Auto and background tasks need
    a budget.
11. **The person's view is theirs.** Agent frames come from the shadow view of a window, or from a warm page of the
    scene pool when no window is open. No agent tool moves the person's camera, clock, selection or focus.
12. **Presence.** The host sends `agent.presence { session, reads, writes, camera }` while a turn runs; the windows mark
    those entities in the session colour and show the camera as a frustum.
13. **One tool layer.** The built-in session, the terminal, background tasks and MCP clients call the same tools
    through the host. A tool that edits runs commands of the one registry; a tool call with many ops applies all of
    them or none.

## Consequences

- `ProposalMode` of `packages/editor-core/src/runner.ts` becomes the session mode; a proposal is an op of a change set.
- The sequencer gets change sets like the scene (UI8-04), because every document of the project session takes them.
- The chat modes of the workbench map so: "ask" → `ask`, "edits" → `review`, "all" → only background tasks of an
  admin in their own worktree.
- An MCP client is a session too, so it needs a connection approval (UI5-15) before its first edit.
- Change sets and checkpoints use the host state folder; a project folder never holds them.
