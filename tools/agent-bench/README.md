# The agent benchmark

The agent benchmark: 24 tasks that a person gives to an
agent, each on a copy of a sample, each with a check of the documents after the run.

## Run it

```sh
bun tools/agent-bench/run.ts --dry                    # no agent: each check must fail (0 of 24)
bun tools/agent-bench/run.ts --solve                  # the right answers of the tests: each check must pass (24 of 24)
bun tools/agent-bench/run.ts --budget 1 --minutes 8   # a real run with the files adapter (it costs money)
bun tools/agent-bench/run.ts --cases time-marker,look-warm-key --model sonnet
bun tools/agent-bench/run.ts --adapter studio         # the same cases through a session of Scenity Studio
SCENITY_AGENT_SCRIPT=<file> bun tools/agent-bench/run.ts --adapter studio --cases look-dark-floor  # no model
```

A run writes `results.json`, `summary.md`, a transcript per case (`transcripts/<case>.jsonl`) and the project copies
(`projects/<case>`) into `--out` (default `.scenity/agent-bench/<time>`; Git ignores `.scenity/`). `--budget` is the
cost limit of each case in US dollars, `--turns` the turn limit and `--minutes` the time limit.

## The cases

| Category  | Cases                                                                                     |
| --------- | ----------------------------------------------------------------------------------------- |
| placement | a reading lamp, four stools, the ottoman, a fast spinner, a second bench, a stacked crate |
| look      | a warmer key light, a night scene, fog, a dark floor                                      |
| time      | a camera zoom track, a marker, a longer sequence, a new tour sequence                     |
| assets    | the import of a model, a new material asset, tags                                         |
| rules     | a new block rule, a fix of a failed check, a model under the floor                        |
| code      | a new field of a plugin component, a new plugin component with a system                   |
| project   | a quality budget, a build and its player size                                             |

Each case (`cases-scene.ts`, `cases-more.ts`) has a prompt in the words of a person, an optional setup (a broken state
to fix), a check of the documents (`checks.ts`) and a right answer for the tests (`solve`, or `solutions.ts` for the
cases that change code or run the CLI). `agent-bench.test.ts` proves that each check fails before the task and passes
after a right answer; no model runs in it.

## The adapters

| Adapter  | What runs                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`  | Claude Code (`claude -p`) in the project copy with the file tools and `bun`: the agent edits the JSON documents and runs the `scenity` command. This is the way of today for a person with Claude Code and no studio                                                                                          |
| `studio` | `studio.ts`: a session of Scenity Studio in the auto mode with the limits of the case. The adapter starts a host, opens the project copy in an editor window (headless Chromium), sends the prompt with the words of `studioPreamble()`, waits for the end of the turn, and saves the documents of the window |

The prompt of each case starts with the same words (`preamble()` of `adapters.ts`): where the documents, the docs
(copied into `.bench/docs` of the project) and the `scenity` command are.

## What the summary gives

Passed cases per category, the median time, the cost, and for each case its time, cost, turns, tool calls and the
detail of its check.

## The journeys with a model

`journeys.ts` runs the journeys that need a model (the start from a sentence and a new plugin), through the studio (the Claude driver
of the host, so a run costs money):

```sh
bun tools/agent-bench/journeys.ts                                   # the start journey with its five prompts, then the plugin journey
bun tools/agent-bench/journeys.ts --journey start --prompts museum --minutes 12
bun tools/agent-bench/journeys.ts --journey plugin
```

| Journey | What runs                                                                                                                                                                                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| start   | `journeyStart.ts`: the Hub of a new host, the words in the new project wizard, "Start from the prompt"; the first scene must wait as a change set. The person accepts it and saves; the check needs each part of the words in the scene (for example 3 statues and 3 plinths). Five prompts (`START_PROMPTS`); the target is 4 of 5    |
| plugin  | `journeyPlugin.ts`: a copy of the showroom; the Plugins window makes `bounce` with `bob` (`height`, `speed`) and a system; "Ask the agent to write it" with the behaviour; the person answers each file write once. The checks: the system is not the stub, `scenity check` passes, the inspector adds `bounce.bob`, and Play moves it |

A run writes `results.json`, `summary.md` and the projects into `--out` (default `.scenity/journeys/<time>`).
`journeys.test.ts` tests the checks with no model.
