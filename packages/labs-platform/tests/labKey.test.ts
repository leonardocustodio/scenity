// SPDX-License-Identifier: Apache-2.0
// The page key of a lab server and the lab ticket parameter.
import { describe, expect, test } from "bun:test";
import { hasLabKey, pageKeyGate, withLabKey, withoutLabKey } from "../src/labKey";

describe("the page key", () => {
  test("a URL gets the key, and the kept URL loses the key and the lab ticket", () => {
    const keyed = withLabKey("http://127.0.0.1:5175/?take=greet", "k1");
    expect(keyed).toBe("http://127.0.0.1:5175/?take=greet&labsKey=k1");
    expect(withoutLabKey(`${keyed}&labTicket=1.abc`)).toBe("http://127.0.0.1:5175/?take=greet");
    expect(withoutLabKey("not a url labsKey=1")).toBe("not a url labsKey=1");
  });

  test("the gate lets a module through and asks a page for the key", () => {
    const page = { method: "GET", url: "/", headers: { "sec-fetch-dest": "document" } };
    const module = { method: "GET", url: "/src/main.ts", headers: { "sec-fetch-dest": "script" } };
    expect(hasLabKey({ ...page, url: "/?labsKey=k1" }, "k1")).toBe(true);
    expect(hasLabKey({ ...page, headers: { ...page.headers, "x-scenity-labs-key": "k1" } }, "k1")).toBe(true);
    expect(hasLabKey(page, "k1")).toBe(false);
    const statuses: number[] = [];
    let passed = 0;
    const response = { writeHead: (status: number) => statuses.push(status), end: () => undefined };
    const gate = pageKeyGate("k1");
    gate(module, response, () => (passed += 1));
    gate(page, response, () => (passed += 1));
    gate({ ...page, url: "/?labsKey=k1" }, response, () => (passed += 1));
    pageKeyGate(null)(page, response, () => (passed += 1));
    expect(passed).toBe(3);
    expect(statuses).toEqual([401]);
  });
});
