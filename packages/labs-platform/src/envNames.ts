// SPDX-License-Identifier: Apache-2.0
/**
 * The environment variables of Scenity. Their names start with `SCENITY_`. For compatibility, a process also reads
 * the old name, with `CODEBLUE_` in place of `SCENITY_`. It writes one warning for each old name that it uses. A
 * process that starts a child process sets the new name.
 *
 * Bun and Node code only: a page has no environment.
 */

/** The environment as the readers see it (`process.env`, or a record that a test gives). */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

/** The prefix of the names. */
export const ENV_PREFIX = "SCENITY_";
/** The prefix of the old names, which a process also reads for compatibility. */
export const OLD_ENV_PREFIX = "CODEBLUE_";

const warned = new Set<string>();

/** The old name of a variable: `SCENITY_X` gives `CODEBLUE_X`. Another name gives null. */
export function oldEnvName(name: string): string | null {
  return name.startsWith(ENV_PREFIX) ? `${OLD_ENV_PREFIX}${name.slice(ENV_PREFIX.length)}` : null;
}

/** The names of a variable: the new name and, when it has one, the old name. */
export function envNames(name: string): string[] {
  const old = oldEnvName(name);
  return old === null ? [name] : [name, old];
}

function processEnv(): EnvRecord {
  const host = globalThis as { process?: { env?: EnvRecord } };
  return host.process?.env ?? {};
}

/**
 * The value of a variable. When the new name has no value, the old name gives the value, and the process writes
 * one warning for that old name.
 */
export function envValue(name: string, env: EnvRecord = processEnv()): string | undefined {
  const value = env[name];
  if (value !== undefined) return value;
  const old = oldEnvName(name);
  const oldValue = old === null ? undefined : env[old];
  if (old !== null && oldValue !== undefined && !warned.has(old)) {
    warned.add(old);
    console.warn(`${old} is an old name: use ${name}. The old name stops in a later version.`);
  }
  return oldValue;
}

/** A copy of an environment without the variables of `names`, with their old names removed too. */
export function withoutEnv(env: EnvRecord, names: readonly string[]): Record<string, string | undefined> {
  const removed = new Set(names.flatMap(envNames));
  return Object.fromEntries(Object.entries(env).filter(([key]) => !removed.has(key)));
}
