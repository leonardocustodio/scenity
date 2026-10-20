// SPDX-License-Identifier: Apache-2.0
/**
 * The core of the workbench bridge: the message handling, the calls and the events, with no window, no Vue and no lab
 * module. The lab page (workbenchBridge.ts) and the scene page (src/scene/sceneBridge.ts) start a bridge over it with their own script API and calls.
 *
 * A call is a call of `calls` (the calls of the page itself), else a method of the script API. A typed call
 * (`typed`, `@scenity/bridge`) checks its arguments before the method runs. The bridge answers only a message from the
 * parent with the workbench origin, and it posts only to that origin.
 */
import {
  answerOf,
  bridgeCallTable,
  errorMessage,
  eventMessage,
  readCall,
  type BridgeCallDef,
  type BridgeEventBody,
} from "@scenity/bridge";
import type { ConsoleHost } from "./workbenchConsole";
import type { UrlHost } from "./workbenchEvents";

/** The target of the messages of the bridge: `window.parent`. */
export interface BridgeParent {
  /** `transfer` moves the picture bytes of a result to the page (no copy). */
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

/** A message that the page receives (a `MessageEvent`). */
export interface BridgeMessage {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
}

/** A call of the bridge that is not a method of the lab API: it gets the args array. */
export type BridgeCall = (args: readonly unknown[]) => unknown;

export interface BridgeOptions {
  /** The origin of the workbench page. */
  readonly origin: string;
  readonly parent: BridgeParent;
  /** The script API of the page (`globalThis.__room3dLab`, `globalThis.__scenity`), or undefined before the page sets it. */
  readonly api: () => object | undefined;
  /** The calls of the bridge itself: `capture`, `url`, `console`. */
  readonly calls: Readonly<Record<string, BridgeCall>>;
  /** It runs each call (a hidden page wakes for a call that needs frames). Default: the call alone. */
  readonly around?: (call: string, run: () => Promise<unknown>) => Promise<unknown>;
  /** The typed calls of the methods of the lab API: the bridge checks their arguments first. */
  readonly typed?: readonly BridgeCallDef[];
}

export interface WorkbenchBridge {
  /** Answer one message. Other sources, other origins and other messages get no answer. */
  receive(message: BridgeMessage): Promise<void>;
  /** Send an event to the workbench page (`BridgeEvent` of `@scenity/bridge`). */
  emit(body: BridgeEventBody): void;
  /** The names of the calls, sorted. */
  calls(): string[];
}

/** The bridge without the window: the message handling, the calls and the events. */
export function createWorkbenchBridge(options: BridgeOptions): WorkbenchBridge {
  const post = (message: object, transfer: ArrayBuffer[] = []): void => {
    options.parent.postMessage(message, options.origin, transfer);
  };
  const typed = bridgeCallTable(options.typed ?? []);

  function calls(): string[] {
    const api = options.api() as unknown as Record<string, unknown> | undefined;
    const methods = api === undefined ? [] : Object.keys(api).filter((key) => typeof api[key] === "function");
    return [...new Set([...methods, ...Object.keys(options.calls)])].sort();
  }

  async function run(call: string, args: readonly unknown[]): Promise<unknown> {
    return options.around === undefined ? runCall(call, args) : options.around(call, () => runCall(call, args));
  }

  async function runCall(call: string, args: readonly unknown[]): Promise<unknown> {
    const own = Object.hasOwn(options.calls, call) ? options.calls[call] : undefined;
    if (own !== undefined) return own(args);
    const api = options.api() as unknown as Record<string, unknown> | undefined;
    const method = api !== undefined && Object.hasOwn(api, call) ? api[call] : undefined;
    if (typeof method !== "function") {
      throw new Error(
        api === undefined ? "The page API is not ready." : `No call "${call}". Calls: ${calls().join(", ")}.`,
      );
    }
    // A typed call of the plugin checks its arguments with the definition that the caller uses too.
    const checked = typed.get(call)?.args(args) ?? args;
    return await (method as (...values: unknown[]) => unknown).apply(api, [...checked]);
  }

  return {
    async receive(message) {
      if (message.source !== options.parent || message.origin !== options.origin) return;
      const request = readCall(message.data);
      if (request === null) return;
      try {
        // A picture result moves its bytes. Another result goes through the clone check.
        const answer = answerOf(request.id, await run(request.call, request.args));
        post(answer.message, answer.transfer);
      } catch (error) {
        post(errorMessage(request.id, error));
      }
    },
    emit(body) {
      post(eventMessage(body));
    },
    calls,
  };
}

/** The window parts of the bridge (a test gives a fake). */
export type BridgeHost = ConsoleHost &
  UrlHost & {
    readonly parent: BridgeParent;
    readonly location: { readonly href: string; readonly search: string };
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  };
