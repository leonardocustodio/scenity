// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the open sequence for the edit mode of the scene page. They are the file of the sequence and its text
 * at the load, and the clock of the page as the sequencer drives it. They also include the "load" of a new sequence
 * into the core, and the rule check of a sequence save. A page without `edit=1` or with no sequence gets no parts. Thus
 * it draws the scene with no sequence edit.
 */
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { AudioPlayer } from "@scenity/runtime/audio";
import type { DevDocumentClient } from "@scenity/runtime-dev/document/client";
import { defaultSequencePath, type PageClock } from "../clock";
import { pageRuleChecker, readProjectRules } from "../pageRules";
import { devServerFiles } from "../sceneFiles";
import type { PageTime, SequenceEditParts } from "./pageSequence";

/** The page parts that the open sequence reads. */
export interface SequencePage {
  readonly params: URLSearchParams;
  /** The URL of the project folder, with a "/" at the end. */
  readonly base: string;
  readonly client: DevDocumentClient;
  readonly clock: PageClock | null;
  readonly audio: AudioPlayer | null;
  readonly sequence: SequenceDocument | null;
}

/** The clock of the page. Each change sends the clock anchor to the core and moves the voices to the new time. */
function pageTime(page: SequencePage, clock: PageClock): PageTime {
  const changed = (): void => {
    page.audio?.sync();
    page.client.setInput(null);
  };
  return {
    now: () => clock.now(),
    playing: () => clock.playing,
    seek: (t) => {
      clock.seek(t);
      changed();
    },
    play: () => {
      clock.play();
      changed();
    },
    pause: () => {
      clock.pause();
      changed();
    },
    speed: () => clock.speed,
    setSpeed: (speed) => {
      clock.setSpeed(speed);
      changed();
    },
  };
}

/** The parts of the open sequence for `startEditor`, or no parts. */
export async function sequenceEditParts(page: SequencePage): Promise<{ readonly sequence?: SequenceEditParts }> {
  const { params, base, clock, sequence } = page;
  if (params.get("edit") !== "1" || clock === null || sequence === null) return {};
  const path = params.get("sequence") ?? (await defaultSequencePath(base));
  if (path === null) return {};
  const files = devServerFiles(base);
  const [disk, project] = await Promise.all([files.read(path), readProjectRules(base)]);
  return {
    sequence: {
      path,
      doc: sequence,
      diskText: disk.text,
      files,
      time: pageTime(page, clock),
      load: (doc) => page.client.load({ sequence: doc }),
      checkRules: (scene, doc) =>
        pageRuleChecker({ project, sequence: doc, checkRules: (request) => page.client.checkRules(request) })(scene),
    },
  };
}
