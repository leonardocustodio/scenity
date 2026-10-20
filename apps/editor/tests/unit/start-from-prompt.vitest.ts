// SPDX-License-Identifier: Apache-2.0
// Start from a prompt. The editor window of a new project takes the words of the person from its URL. It starts a
// session in review mode and sends the prompt of the first scene. Then it removes the words from the URL.
import { describe, expect, it, vi } from "vitest";
import { firstScenePrompt, startFromPrompt } from "../../src/scene/agent/startFromPrompt";

describe("start from a prompt in the editor window", () => {
  it("sends the words to a new session in review mode, once", async () => {
    const calls: unknown[] = [];
    const store = {
      create: vi.fn((patch?: object) => {
        calls.push(["create", patch]);
        return Promise.resolve();
      }),
      send: vi.fn((text: string) => {
        calls.push(["send", text]);
        return Promise.resolve(true);
      }),
    };
    const shell = { showPanel: vi.fn() };
    const replace = vi.spyOn(history, "replaceState").mockImplementation(() => undefined);
    const href = "http://127.0.0.1/scene.html?project=shop&edit=1&prompt=a%20red%20box";
    expect(await startFromPrompt(store, shell, href)).toBe(true);
    expect(calls).toEqual([
      ["create", { name: "The first scene", mode: "review" }],
      ["send", firstScenePrompt("a red box")],
    ]);
    expect(shell.showPanel).toHaveBeenCalledWith("agent");
    expect(String(replace.mock.calls.at(-1)?.[2])).toBe("http://127.0.0.1/scene.html?project=shop&edit=1");
    expect(await startFromPrompt(store, shell, "http://127.0.0.1/scene.html?project=shop&edit=1")).toBe(false);
    expect(store.send).toHaveBeenCalledTimes(1);
    replace.mockRestore();
  });
});
