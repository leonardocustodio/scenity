// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the workbench bridge on the page. The bridge sets it while the bridge is active (workbenchBridge.ts).
 * This is a declaration file, so each program that reads the state (the editor, the editor face of a plugin) has it
 * without an import of the bridge.
 */
import type { WorkbenchInfo } from "./workbenchBridge";

declare global {
  var __workbench: WorkbenchInfo | undefined;
}
