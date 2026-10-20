// SPDX-License-Identifier: Apache-2.0
/** Tests of the request router. */
import { describe, expect, test } from "bun:test";
import { Router, needString, optString } from "../src/router";
import type { PageClient } from "../src/server";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const client: PageClient = { id: 1, origin: null, role: "admin", send: () => undefined };

describe("the router", () => {
  const router = new Router()
    .on("checkouts.open", (params) => ({ checkout: { path: needString(params, "path") } }) as never)
    .on("checkouts.list", () => {
      throw new Error("no repository");
    });

  test("a request gets the result of its handler with its id", async () => {
    const answer = await router.dispatch(JSON.stringify({ id: 7, type: "checkouts.open", path: "/x" }), client);
    expect(answer).toEqual({ id: 7, ok: true, result: { checkout: { path: "/x" } } });
  });

  test("a handler error gives ok false with the message", async () => {
    expect(await router.dispatch(JSON.stringify({ id: 2, type: "checkouts.list" }), client)).toEqual({
      id: 2,
      ok: false,
      error: "no repository",
    });
    const bad = await router.dispatch(JSON.stringify({ id: 3, type: "checkouts.open" }), client);
    expect(bad).toEqual({ id: 3, ok: false, error: 'The parameter "path" must be a text.' });
  });

  test("a known type without a handler gives an error", async () => {
    const answer = await router.dispatch(JSON.stringify({ id: 4, type: "git.status" }), client);
    expect(answer?.ok).toBe(false);
    expect(router.has("git.status")).toBe(false);
  });

  test("an unknown type with an id gives an error; text without an id gives no answer", async () => {
    expect(await router.dispatch(JSON.stringify({ id: 5, type: "nope" }), client)).toEqual({
      id: 5,
      ok: false,
      error: 'Unknown request type: "nope".',
    });
    expect(await router.dispatch("not json", client)).toBeNull();
    expect(await router.dispatch(JSON.stringify({ type: "checkouts.list" }), client)).toBeNull();
  });

  test("the parameter checks", () => {
    expect(needString({ a: "x" }, "a")).toBe("x");
    expect(() => needString({ a: 1 }, "a")).toThrow('"a"');
    expect(optString({}, "a")).toBeUndefined();
    expect(optString({ a: null }, "a")).toBeUndefined();
    expect(() => optString({ a: 2 }, "a")).toThrow('"a"');
  });
});
