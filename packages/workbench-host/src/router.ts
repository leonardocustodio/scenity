// SPDX-License-Identifier: Apache-2.0
/**
 * The request router of the host. It reads a request of a page, calls the
 * handler of its type and makes the answer `{ id, ok, result }` or `{ id, ok: false, error }`.
 */
import {
  answerError,
  answerOk,
  isRecord,
  parseJson,
  readRequest,
  type Answer,
  type RequestParams,
  type RequestResult,
  type RequestType,
} from "./protocol";
import type { PageClient } from "./server";

/** The handler of one request type. It throws an error to answer `ok: false`. */
export type Handler<T extends RequestType> = (
  params: RequestParams<T>,
  client: PageClient,
) => RequestResult<T> | Promise<RequestResult<T>>;

type AnyHandler = (params: unknown, client: PageClient) => unknown;

/** A check of a request before its handler: an error text refuses it, null lets it continue. */
export type RequestGuard = (type: RequestType, params: Record<string, unknown>, client: PageClient) => string | null;

/** The text of a thrown value. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Router {
  readonly #handlers = new Map<RequestType, AnyHandler>();
  readonly #guards: RequestGuard[] = [];

  /**
   * A check before each request (a folder without Git, the role of the page). A text refuses the
   * request with that error. The checks run in the order of the calls.
   */
  guard(check: RequestGuard): this {
    this.#guards.push(check);
    return this;
  }

  /** Set the handler of a request type. A second call for the same type replaces the first handler. */
  on<T extends RequestType>(type: T, handler: Handler<T>): this {
    this.#handlers.set(type, handler as AnyHandler);
    return this;
  }

  /** True when the type has a handler. */
  has(type: RequestType): boolean {
    return this.#handlers.has(type);
  }

  /**
   * Handle the text of a WebSocket message. Give the answer, or null when the text has no request `id` (the host
   * cannot answer it).
   */
  async dispatch(text: string, client: PageClient): Promise<Answer | null> {
    const request = readRequest(text);
    if (request === null) return answerToBadText(text);
    const { id } = request;
    const params = Object.fromEntries(Object.entries(request).filter(([key]) => key !== "id" && key !== "type"));
    for (const check of this.#guards) {
      const refusal = check(request.type, params, client);
      if (refusal !== null) return answerError(id, refusal);
    }
    const handler = this.#handlers.get(request.type);
    if (handler === undefined) return answerError(id, `This host has no handler for "${request.type}" yet.`);
    try {
      return answerOk(id, await handler(params, client));
    } catch (error) {
      return answerError(id, errorText(error));
    }
  }
}

function answerToBadText(text: string): Answer | null {
  const value = parseJson(text);
  if (!isRecord(value)) return null;
  const { id } = value;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return null;
  return answerError(id, `Unknown request type: ${JSON.stringify(value.type ?? null)}.`);
}

// The checks of the parameters. A check throws an error with the name of the bad parameter.
/** Give the string parameter, or throw an error. */
export function needString(params: object, name: string): string {
  const value = (params as Record<string, unknown>)[name];
  if (typeof value !== "string" || value === "") throw new Error(`The parameter "${name}" must be a text.`);
  return value;
}

/** Give the string parameter, undefined when it is absent, or throw an error. */
export function optString(params: object, name: string): string | undefined {
  const value = (params as Record<string, unknown>)[name];
  if (value === undefined || value === null) return undefined;
  return needString(params, name);
}
