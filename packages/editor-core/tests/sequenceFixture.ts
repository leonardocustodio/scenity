// SPDX-License-Identifier: Apache-2.0
/**
 * The fixture editor of the sequencer tests: the garden scene in a scene channel, a sequence channel in the same
 * history, the recorder of the record mode, and a runner of the sequence commands, as the scene page has them.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { SequenceDocument } from "@scenity/scene/sequence";
import {
  createCommandRegistry,
  createRunner,
  editProblems,
  SceneChannel,
  sceneOpKind,
  SEQUENCE_CHANNEL,
  SEQUENCE_COMMANDS,
  SEQUENCE_OP,
  SequenceChannel,
  SequenceRecorder,
  type CommandHost,
  type OpContext,
  type SequenceCommandState,
  type SequenceOp,
} from "../src/index";
import { cell, components, garden } from "./helpers";

const NO_TUNES: OpContext = { known: () => false, defaults: new Map() };

/** An empty sequence of the garden of `duration` ms. */
export function emptySequence(duration = 4000): SequenceDocument {
  return { format: "scenity.sequence/1", id: "tour", scene: "garden", duration, tracks: [] };
}

export function sequenceEditor(sequence: SequenceDocument = emptySequence(), doc: SceneDocument = garden()) {
  const runtime: { scene: SceneOp[][]; sequences: SequenceDocument[] } = { scene: [], sequences: [] };
  const time = cell(0);
  const sequenceChannel = new SequenceChannel({ doc: sequence, send: (next) => runtime.sequences.push(next) });
  const channel = new SceneChannel<SceneDocument>({
    doc,
    registry: components,
    patch: (ops) => runtime.scene.push([...ops]),
    channels: { [SEQUENCE_CHANNEL]: sequenceChannel.channel },
    kinds: [SEQUENCE_OP],
  });
  const recorder = new SequenceRecorder<SceneDocument>(sequenceChannel, () => time.value);
  channel.recorder = recorder;
  const registry = createCommandRegistry<SequenceCommandState, CommandHost, SequenceOp>();
  registry.register(SEQUENCE_COMMANDS);
  const kinds = [sceneOpKind(components), SEQUENCE_OP];
  const runner = createRunner<SequenceCommandState, CommandHost, SequenceOp>({
    registry,
    state: () => ({ selection: null, scene: channel.doc, sequence: sequenceChannel.doc, time: time.value }),
    host: { select: () => undefined, undo: () => channel.undo(), redo: () => channel.redo() },
    apply: (edit) => {
      const result = channel.apply(edit);
      return { step: result.applied, pending: result.pending, sent: [] };
    },
    problems: (edit) => editProblems(edit, kinds, NO_TUNES),
    proposals: cell([]),
    mode: cell("propose"),
    keepMode: () => undefined,
  });
  /** Run a command as the owner: it applies at once. */
  const run = (id: string, args: Record<string, unknown> = {}) => runner.run(id, args, { by: "owner" });
  return { channel, sequence: sequenceChannel, recorder, runtime, time, runner, run };
}
