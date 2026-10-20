// SPDX-License-Identifier: Apache-2.0
/**
 * The rules of a background run: a run never commits. The generated settings of a
 * run send its `PreToolUse`, `PostToolUse` and `Stop` hooks to `/loops/<id>/hooks/<event>`, so the host knows the run
 * of each hook. The `PreToolUse` rule on `Bash` refuses the Git commands of the workbench guard (gitGuard.ts) and also
 * every Git command that makes a commit. A deny rule in the settings is a second guard.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitRefusal, simpleCommands } from "./gitGuard";
import { bunPath } from "./hostRuntime";
import { TOKEN_ENV, TOKEN_HEADER, type HostEndpoint } from "./protocol";
import { mcpConfigJson, ORIGIN_ENV, TOOLS_RULE } from "./settings";

/** The HTTP path prefix of the hooks of the background runs: `/loops/<id>/hooks/<event>`. */
export const LOOP_HOOKS_PREFIX = "/loops/";

/** The Git subcommands that make a commit. A background run never runs them. */
const COMMIT_SUBCOMMANDS = new Set(["commit", "merge", "cherry-pick", "revert", "am", "pull"]);
const SHELLS = new Set(["sh", "bash", "zsh", "/bin/sh", "/bin/bash", "/bin/zsh"]);
const PREFIXES = new Set(["sudo", "command", "exec", "env", "nohup", "time"]);
/** The global options of Git that take a value. */
const VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

/** The Git subcommand of the words of a simple command, or null when the command does not run Git. */
function gitSubcommand(words: readonly string[]): string | null {
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) index++;
  while (PREFIXES.has(words[index] ?? "")) index++;
  const program = words[index] ?? "";
  if (program !== "git" && !program.endsWith("/git")) return null;
  index++;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (VALUE_OPTIONS.has(word)) index += 2;
    else if (word.startsWith("-")) index++;
    else return word;
  }
  return null;
}

/** The refusal of a command that makes a commit (also in `sh -c '…'`), or null. */
export function commitRefusal(command: string, depth = 0): string | null {
  for (const words of simpleCommands(command)) {
    const program = words[0] ?? "";
    if (SHELLS.has(program) && depth < 3) {
      const flag = words.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));
      const script = flag < 0 ? undefined : words[flag + 1];
      const inner = script === undefined ? null : commitRefusal(script, depth + 1);
      if (inner !== null) return inner;
    }
    const sub = gitSubcommand(words);
    if (sub !== null && COMMIT_SUBCOMMANDS.has(sub)) {
      return (
        `A background run of the workbench never commits (git ${sub}). Leave the changes uncommitted: ` +
        "the owner reads the review pack and commits from the Changes tab."
      );
    }
  }
  return null;
}

/** The refusal of a Bash command in a background run: the Git guard of the workbench, then the commit rule. */
export function loopRefusal(command: string): string | null {
  return gitRefusal(command) ?? commitRefusal(command);
}

/** The hooks of a background run: the event, the matcher and the timeout (s). The `Stop` gate runs `labs motion`. */
export const LOOP_HOOKS = [
  { event: "PreToolUse", matcher: "Bash", timeout: 30 },
  { event: "PostToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit", timeout: 30 },
  { event: "Stop", timeout: 600 },
] as const;
export type LoopHookEvent = (typeof LOOP_HOOKS)[number]["event"];

/** True for a hook event of a background run. */
export function isLoopHookEvent(value: string): value is LoopHookEvent {
  return LOOP_HOOKS.some((hook) => hook.event === value);
}

/** The deny rules of a background run: a second guard after the `PreToolUse` hook. */
export const LOOP_DENY = ["Bash(git commit:*)", "Bash(git push:*)", "Bash(git merge:*)", "Bash(git cherry-pick:*)"];

/** The settings JSON of a background run: its hooks, the allow rule of the workbench tools and the deny rules. */
export function loopSettingsJson(origin: string, loop: string): Record<string, unknown> {
  const hooks = Object.fromEntries(
    LOOP_HOOKS.map((hook) => [
      hook.event,
      [
        {
          ...("matcher" in hook ? { matcher: hook.matcher } : {}),
          hooks: [
            {
              type: "http",
              url: `${origin}${LOOP_HOOKS_PREFIX}${encodeURIComponent(loop)}/hooks/${hook.event}`,
              headers: { [TOKEN_HEADER]: `$${TOKEN_ENV}` },
              allowedEnvVars: [TOKEN_ENV],
              timeout: hook.timeout,
            },
          ],
        },
      ],
    ]),
  );
  return { hooks, permissions: { allow: [TOOLS_RULE], deny: LOOP_DENY } };
}

/** Read the run and the event of a hook path `/loops/<id>/hooks/<event>`, or null for another path. */
export function loopHookPath(pathname: string): { loop: string; event: LoopHookEvent } | null {
  const match = /^\/loops\/([^/]+)\/hooks\/([A-Za-z]+)$/.exec(pathname);
  if (match === null) return null;
  const event = match[2] ?? "";
  return isLoopHookEvent(event) ? { loop: decodeURIComponent(match[1] ?? ""), event } : null;
}

/** The generated files of a background run. */
export interface LoopFiles {
  readonly dir: string;
  readonly mcpConfig: string;
  readonly settings: string;
  readonly env: Readonly<Record<string, string>>;
}

function writePrivate(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Write `<state>/claude/loops/<id>/{mcp,settings}.json` (mode 600). The MCP config has the `workbench` server and the
 * extra servers (the owner's Blender server when the checkout setting is on).
 */
export function writeLoopFiles(
  stateDir: string,
  endpoint: HostEndpoint,
  loop: string,
  extraServers: Readonly<Record<string, unknown>> = {},
): LoopFiles {
  const dir = join(stateDir, "claude", "loops", loop);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const mcpConfig = join(dir, "mcp.json");
  const settings = join(dir, "settings.json");
  const mcp = mcpConfigJson(endpoint, bunPath());
  const servers = { ...(mcp.mcpServers as Record<string, unknown>), ...extraServers };
  writePrivate(mcpConfig, { mcpServers: servers });
  writePrivate(settings, loopSettingsJson(endpoint.origin, loop));
  return { dir, mcpConfig, settings, env: { [TOKEN_ENV]: endpoint.token, [ORIGIN_ENV]: endpoint.origin } };
}
