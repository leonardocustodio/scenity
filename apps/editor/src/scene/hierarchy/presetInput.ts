// SPDX-License-Identifier: Apache-2.0
/**
 * The input of a create preset: a preset with an input (the prefab source of a prefab
 * instance, the model of a character) asks the person for it when a run of the person gives none (the Entity menu, the
 * + menu of the hierarchy, the search box). An agent or a script gives the input as an argument; a run of theirs with
 * no input gets the reason of the preset.
 */
import { CommandError, ENTITY_PRESETS, type CommandOptions } from "@scenity/editor-core";
import { currentShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import { textOrAsk } from "../projects/fileCommands";

type Args = Readonly<Record<string, unknown>>;

/** The arguments of a run with the input of its preset: the given input, else the answer of the person. */
export async function presetArgs(id: string, args: Args, options: CommandOptions): Promise<Args> {
  const preset = ENTITY_PRESETS.find((item) => `entity.create.${item.id}` === id);
  const input = preset?.input;
  const notices = currentShell()?.notices;
  if (preset === undefined || input === undefined || notices === undefined) return args;
  if ((options.by ?? "owner") !== "owner") return args;
  const given = args[input.arg];
  if (typeof given === "string" && given.trim() !== "") return args;
  const ask = { title: t(`create-ask-${preset.id}`), label: t(`create-ask-${preset.id}-label`) };
  const value = await textOrAsk(notices, args, input.arg, ask);
  if (value === null) throw new CommandError(t("create-ask-cancelled"));
  return { ...args, [input.arg]: value };
}
