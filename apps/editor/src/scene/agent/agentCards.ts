// SPDX-License-Identifier: Apache-2.0
/**
 * The tool cards of the transcript. A card shows a tool call as a sentence ("Move entity ▸ Armchair"), its targets
 * (the entities that "Show in the scene" selects and frames), its outcome (the first line of the result) and its
 * pictures. Each core tool has a card. Another tool shows its name. The raw call is in the fold of the card.
 */
import { t } from "../../texts";
import type { AgentItem } from "./agentClient";

type ToolItem = Extract<AgentItem, { kind: "tool" }>;

/** A card of a tool call. */
export interface ToolCard {
  readonly title: string;
  /** The entities of the call (for "Show in the scene"). */
  readonly targets: readonly string[];
  /** The first line of the result, or null while the tool runs. */
  readonly outcome: string | null;
  /** "running", "failed", "proposed" or "done". */
  readonly state: "running" | "failed" | "proposed" | "done";
  /** When true, the card shows the full result (the output of a job). */
  readonly output: boolean;
}

/** What the cards read of the window: the title of a command and the name of an entity. */
export interface CardNames {
  command(id: string): string;
  entity(id: string): string;
}

/** The argument keys that name entities. */
const TARGET_KEYS = ["entity", "entities", "ids", "id", "parent", "target", "from", "to"];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The entities of the arguments of a call. */
export function targetsOf(args: Record<string, unknown>, known: (id: string) => boolean): string[] {
  const found = TARGET_KEYS.flatMap((key) => strings(args[key])).filter(known);
  return [...new Set(found)];
}

/** The title of a card for a tool and its input. */
function titleOf(item: ToolItem, names: CardNames, targets: readonly string[]): string {
  const input = record(item.input);
  const on = targets.length === 0 ? "" : ` ▸ ${targets.map((id) => names.entity(id)).join(", ")}`;
  switch (item.name) {
    case "scene_command":
      return `${names.command(typeof input.command === "string" ? input.command : "?")}${on}`;
    case "scene_batch": {
      const steps = Array.isArray(input.steps) ? input.steps.length : 0;
      const title = typeof input.title === "string" ? input.title : "";
      return t("agent-card-batch", { count: steps, title });
    }
    case "scene_query":
      return t("agent-card-query") + on;
    case "scene_frame":
    case "scene_sheet":
      return t("agent-card-look");
    case "scene_measure":
      return t("agent-card-measure") + on;
    case "ui_reveal":
    case "ui_highlight":
      return t("agent-card-show") + on;
    case "job_run": {
      const args = Array.isArray(input.args) ? input.args.filter((arg) => typeof arg === "string") : [];
      const line = ["scenity", typeof input.command === "string" ? input.command : "?", ...args].join(" ");
      return t("agent-card-job-run", { line });
    }
    case "job_status":
    case "job_output":
      return t(`agent-card-${item.name.replace("_", "-")}`, { job: typeof input.job === "string" ? input.job : "?" });
    case "studio_state":
    case "scene_commands":
    case "scene_pick":
    case "ui_state":
    case "ui_notify":
      return t(`agent-card-${item.name.replace("_", "-")}`);
    default:
      return item.name;
  }
}

/** The card of a tool item. `known` tells whether an ID is an entity of the open scene. */
export function cardOf(item: ToolItem, names: CardNames, known: (id: string) => boolean): ToolCard {
  const input = record(item.input);
  const args = { ...record(input.args), ...input };
  const steps = Array.isArray(input.steps) ? input.steps.map((step) => record(record(step).args)) : [];
  const targets = [...new Set([...targetsOf(args, known), ...steps.flatMap((step) => targetsOf(step, known))])];
  const outcome = item.result === null ? null : (item.result.split("\n")[0] ?? "");
  const state =
    item.result === null
      ? "running"
      : item.isError
        ? "failed"
        : outcome?.startsWith("Proposal") === true
          ? "proposed"
          : "done";
  const output = item.name === "job_output" || item.name === "job_status";
  return { title: titleOf(item, names, targets), targets, outcome, state, output };
}
