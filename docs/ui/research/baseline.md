# The usability baseline (UI0-05)

The study of today's tools before the studio: five people do journeys J1 to J8 of [vision.md](../vision.md) §6 with
the scene page, the CLI and the workbench of 2026-10-17. UI14-08 runs the same study on the studio, so the two sets of
numbers compare. **Status: the kit is ready; the sessions with people are an owner step.**

## The people

| Person | Profile                                                |
| ------ | ------------------------------------------------------ |
| P1, P2 | New to 3D tools; at ease with a web app and a terminal |
| P3, P4 | Unity users (a year or more), new to Scenity           |
| P5     | A developer (TypeScript), new to Scenity               |

## The setup

- A Mac with the checkout at the state of the study, `bun install` and `bun run generate` done, and Chromium.
- A clean user state: no browser storage of the editor, no studio state folder, no project in `~/work`.
- The docs open in a second window (`docs/README.md`); the person may read them. Each look at the docs counts as a
  request for help.
- A recording of the screen and the voice (with consent), and a timer.
- The moderator gives each journey as written below, does not show the way, and answers only "What would you try?".
  After 10 minutes on one journey, the moderator gives the next step and marks the journey "with help".

## The journeys as the moderator reads them

| ID  | Task for the person                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| J1  | "Make a new empty Scenity project called demo in ~/work and open it in the editor. Then close it and open it again."                             |
| J2  | (Not in the baseline: today has no way to start from a sentence.)                                                                                |
| J3  | "Add this model (RobotExpressive.glb on the desktop) to the scene, stand it on the floor, make it about human size and save."                    |
| J4  | "Add a point light and a camera named Side. Give the scene a sky (the studio HDR of the showroom), more exposure and fog. Make the box red."     |
| J5  | "Make a prefab of the table and the lantern, place it twice, make one lantern brighter, then make that change on every copy."                    |
| J6  | "Make a 6-second sequence: the camera moves closer to the table. Play it. Record a click in play mode and replay it."                            |
| J7  | "Make a rule that the lamp stays at least 1.5 m above the floor. Move the lamp so the rule fails, see it fail, then fix it and save."            |
| J8  | "Build the project for the web, tell me the size of the player, take a picture from the front camera, and give me the code to embed the player." |

J9 to J12 (agents, plugins, variants, background tasks) are not in the baseline: today's tools need the workbench, a
host started by hand and a token, which the study gives in J1 as the start of the "agent" track only if time allows.

## What to record per journey

| Measure    | How                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Time       | From the end of the task text to the moment the person says "done" (or the moderator stops)     |
| Done       | Done, done with help, or not done                                                               |
| Errors     | Each wrong path that the person must undo or leave (a wrong command, a wrong file, a lost edit) |
| Help       | Each look at the docs, each question to the moderator                                           |
| Terminal   | The number of terminal commands the person typed                                                |
| Hand edits | The number of times the person edited a JSON file by hand                                       |
| Quotes     | What the person said when stuck or surprised                                                    |

After the eight journeys: the System Usability Scale (SUS, 10 items) and three open questions: "What was hardest?",
"What did you look for and not find?", "What would you show a friend?".

## The sheet

One row per person and journey (copy it into a spreadsheet):

```text
person, journey, time_s, done (yes|help|no), errors, help, terminal_commands, hand_edits, notes
```

## The results

To fill after the sessions: the table per journey (median time, done share, errors, help), the SUS score of each
person and the mean, and the top 20 problems with their journey, their count and a quote. The top problems feed the
tasks of the plan (a problem with no task gets one).
