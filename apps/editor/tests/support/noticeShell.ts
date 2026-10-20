// SPDX-License-Identifier: Apache-2.0
/**
 * The dialogs of the editor window in a unit test: a shell with the notices service only. Thus a notice of the file
 * bar is a dialog request that the test reads and answers by the test ID of an action.
 */
import { WindowNotices } from "../../src/studio/shell/dialogs";
import { WindowStatus } from "../../src/studio/shell/status";
import { setCurrentShell, type StudioShell } from "../../src/studio/shell/shell";

/** A shell with the notices of a window; the page code finds it as the current shell. */
export function noticeShell(): WindowNotices {
  const notices = new WindowNotices();
  setCurrentShell({ notices, status: new WindowStatus() } as unknown as StudioShell);
  return notices;
}

/** Press the action of the dialog that shows now (by the test ID of its button), with the text of the field. */
export async function answer(notices: WindowNotices, testId: string, text = ""): Promise<void> {
  const action = notices.dialog?.actions.find((item) => item.testId === testId);
  if (action === undefined) throw new Error(`the dialog has no action ${testId}`);
  notices.answer(action.id, text);
  // The action of the answer runs after the promise of the dialog.
  await Promise.resolve();
  await Promise.resolve();
}
