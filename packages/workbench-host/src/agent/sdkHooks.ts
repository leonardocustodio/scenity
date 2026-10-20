// SPDX-License-Identifier: Apache-2.0
/**
 * The hooks of the workbench as SDK callbacks. Each callback calls the same
 * `handleHook` as the host route `POST /hooks/<event>` of the terminal mode, with the same events, matchers and
 * timeouts (`HOOKS` of settings.ts): the context packet on `UserPromptSubmit`, the Git refusal on `PreToolUse` of
 * `Bash`, the files of the turn on `PostToolUse` of the edit tools, the `Notification`, the `Stop` option and the
 * session records. The SDK gives the same payload fields as the CLI (`session_id`, `cwd`, `tool_name`, …).
 */
import { handleHook, type HookDeps } from "../hooks";
import type { HookEvent } from "../protocol";
import { HOOKS } from "../settings";
import type { HookCallback, HookCallbackMatcher, Options } from "./sdk";

/** The callback of one event. */
export function hookCallback(event: HookEvent, deps: () => HookDeps): HookCallback {
  return async (input) => await handleHook(event, input, deps());
}

/** The `hooks` option of a session: one matcher per entry of `HOOKS`. */
export function sdkHooks(deps: () => HookDeps): NonNullable<Options["hooks"]> {
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  for (const { event, matcher, timeout } of HOOKS) {
    const entry: HookCallbackMatcher = { hooks: [hookCallback(event, deps)], timeout };
    if (matcher !== undefined) entry.matcher = matcher;
    (hooks[event] ??= []).push(entry);
  }
  return hooks;
}
