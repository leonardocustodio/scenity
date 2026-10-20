// SPDX-License-Identifier: Apache-2.0
/**
 * The entry point `@scenity/cli/check`: `scenity check`, the headless rule check of a project, and the save whose gate
 * measures by itself. Only this entry depends on `@scenity/runtime-dev` and `@scenity/runtime`: the plain CLI and the
 * Vite plugin entries stay light. A user imports it on demand.
 */
export { CheckSetupError, type AssetOrigin } from "./assets";
export { CHECK_USAGE, parseCheckArgs, runCheckCommand, type CommandResult } from "./command";
export { measureSavedRules } from "./measure";
export { blocks, reportText, type CheckReport, type CheckRow } from "./rows";
export { runCheck, type CheckOptions } from "./run";
export { hasRuleResults, saveMeasured } from "./save";
