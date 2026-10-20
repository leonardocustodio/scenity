// SPDX-License-Identifier: Apache-2.0
/**
 * Typed calls of the bridge. A definition gives the name of a call, the check of its
 * arguments and the read of its result. The frame (the editor) serves a call with `serveBridgeCall`; the caller (the
 * host, the workbench page) sends it with `sendBridgeCall`. Both sides use the same definition, so they use the same
 * contract. A plugin defines its own calls with `defineBridgeCall`; the base calls are in base.ts.
 *
 * The module is pure: no Vue, no DOM, no Node API.
 */

/** A typed call of the bridge. */
export interface BridgeCallDef<
  Args extends readonly unknown[] = readonly unknown[],
  Result = unknown,
  Name extends string = string,
> {
  readonly name: Name;
  /** Check the arguments of a call and give them typed. Throw an `Error` with the reason. */
  readonly args: (raw: readonly unknown[]) => Args;
  /** Read the result of a call and give it typed. Throw an `Error` with the reason. */
  readonly result: (raw: unknown) => Result;
}

/** The arguments of a call definition. */
export type BridgeCallArgs<Def> = Def extends BridgeCallDef<infer Args> ? Args : never;
/** The result of a call definition. */
export type BridgeCallResult<Def> = Def extends BridgeCallDef<readonly unknown[], infer Result> ? Result : never;

/** The fields of `defineBridgeCall`. Without `args`, each argument list passes; without `result`, each result passes. */
export interface BridgeCallSpec<Args extends readonly unknown[], Result, Name extends string> {
  readonly name: Name;
  readonly args?: (raw: readonly unknown[]) => Args;
  readonly result?: (raw: unknown) => Result;
}

/** The form of a call name: a letter, then letters, digits, `.` or `_`. */
const CALL_NAME = /^[A-Za-z][A-Za-z0-9._]*$/;

/** Define a typed call of the bridge. */
export function defineBridgeCall<
  Args extends readonly unknown[] = readonly unknown[],
  Result = unknown,
  const Name extends string = string,
>(spec: BridgeCallSpec<Args, Result, Name>): BridgeCallDef<Args, Result, Name> {
  if (!CALL_NAME.test(spec.name)) throw new Error(`The bridge call name "${spec.name}" is not valid.`);
  return {
    name: spec.name,
    args: spec.args ?? ((raw) => raw as unknown as Args),
    result: spec.result ?? ((raw) => raw as Result),
  };
}

/** The frame side: a handler of a call. It gets the checked arguments; the bridge gives the raw argument list. */
export function serveBridgeCall<Args extends readonly unknown[], Result>(
  def: BridgeCallDef<Args, Result>,
  handler: (...args: Args) => Result | Promise<Result>,
): (raw: readonly unknown[]) => Promise<Result> {
  return async (raw) => handler(...def.args(raw));
}

/** How a caller sends one call: the name and the arguments, and the promise of the raw result. */
export type BridgeSend = (call: string, args: readonly unknown[]) => Promise<unknown>;

/** The caller side: check the arguments, send the call and read its result. */
export async function sendBridgeCall<Args extends readonly unknown[], Result>(
  def: BridgeCallDef<Args, Result>,
  send: BridgeSend,
  ...args: Args
): Promise<Result> {
  return def.result(await send(def.name, def.args(args)));
}

/** A map of call definitions by name. Throws for two definitions with one name. */
export function bridgeCallTable(defs: readonly BridgeCallDef[]): ReadonlyMap<string, BridgeCallDef> {
  const table = new Map<string, BridgeCallDef>();
  for (const def of defs) {
    if (table.has(def.name)) throw new Error(`Two bridge calls have the name "${def.name}".`);
    table.set(def.name, def);
  }
  return table;
}

// The checks of the argument lists of common forms.

/** Throw the error of a call with a bad argument. */
export function argError(call: string, text: string): never {
  throw new Error(`${call}: ${text}`);
}

/** The check of a call without arguments: the check ignores extra arguments. */
export function noArgs(): [] {
  return [];
}
