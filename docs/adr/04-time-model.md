# ADR 04: The time model

- Task: SE6-01 of `docs/generic-engine-plan.md`
- Date: 2026-10-15
- Status: **accepted (provisional)**. The owner can change it.

## Context

Today time is a take: a list of clinical events, a preset in TypeScript and `labStateAt`, which replays the events
with 1 s checkpoints. The frame at a time is a pure function of the take, the URL and the time. The engine must keep
that rule for any content and any simulation.

## Decision

1. **A frame is `evaluate(documents, overrides, sequence, t, plugins)`.** The documents are the project, the scene and
   its prefabs. The override layers apply in order: variants, then the sequence values at `t`, then URL values, then
   proposals (proposals draw as ghosts only). `evaluate()` is pure and lives in `@scenity/scene`.
2. **Time is an integer count of milliseconds of simulation time** (`t`). The clock of the page maps wall time to `t`;
   nothing in `evaluate()` or in a system reads wall time.
3. **Tracks and keys.** A sequence holds tracks of kind `property`, `transform`, `visibility`, `event`, `action`,
   `animation`, `camera` (cuts), `attach` and `audio` (SE6-13: play and stop keys; a sound has a start on the time
   line, so a seek starts it at the right position, or not at all after its end). Keys at the same time apply in a stable order: the order of the tracks
   in the file, then the order of the keys in the track.
4. **Simulation plugins** give the meaning of `action` keys: `reduce(state, key)` applies one key, `settle(state, t)`
   advances the state with no key to the time `t`, and `project(state, t)` gives the plugin input of the runtime.
5. **Checkpoints.** The evaluator keeps the state at fixed steps (default 1 s) in a memo, so a seek replays at most
   one step of keys. A memo is a cache: its loss changes no frame.
6. **An optional fixed step.** A project can set a fixed simulation step (for example 1/60 s) for plugins that need
   it (physics). Then the state advances in whole steps, and the frame interpolates between the last two steps.
7. **System memory.** A runtime system can keep memory from frame to frame, but it must give `save()` and
   `restore()`. A seek restores the memory of the nearest checkpoint and runs the frames from there, so a seek gives
   the frame of playback.
8. **Random numbers** come from named streams with a seed of the document (`ctx.random("walk")`). There is no
   `Math.random`, no `Date.now` and no iteration over a `Set` or a `Map` whose order depends on input order in a
   system or a simulation.
9. **The determinism lint** (SE3-07) checks the `sim/` and `systems/` folders of each plugin for these rules.

## Consequences

- Seek equals play is a test for each sequence and each plugin.
- The resus takes become sequences (SE6-04); `labStateAt` becomes the generic evaluator with the resus simulation.
- The frame key (SE2-09) is a hash of the documents, the overrides, the sequence, `t`, the view, the renderer options
  and the content hash.
