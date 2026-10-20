// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { listingsOf, reviveBytes, runToolOf, STUDIO_TOOLS, type SceneToolContext, type ToolResult } from "../src/index";

/** The text of the first block of a result. */
function textOf(result: ToolResult): string {
  const [block] = result.content;
  return block?.type === "text" ? block.text : "";
}

/** A context with a port that gives the answers of a table. */
function contextOf(answers: Record<string, unknown>, calls: string[] = []): SceneToolContext {
  return {
    surface: () => ({
      call: (call) => {
        calls.push(call);
        if (!(call in answers)) return Promise.reject(new Error(`no answer for ${call}`));
        return Promise.resolve(answers[call]);
      },
    }),
  };
}

describe("the studio tools", () => {
  test("the list starts with studio_state and has unique names", () => {
    const names = STUDIO_TOOLS.map((tool) => tool.name);
    expect(names[0]).toBe("studio_state");
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("scene_command");
  });

  test("a listing has a JSON schema of type object and the load hint", () => {
    const listings = listingsOf(STUDIO_TOOLS);
    const state = listings.find((item) => item.name === "studio_state");
    expect(state?.inputSchema.type).toBe("object");
    expect(state?._meta?.["anthropic/alwaysLoad"]).toBe(true);
    const command = listings.find((item) => item.name === "scene_command");
    expect(Object.keys(command?.inputSchema.properties ?? {})).toContain("command");
    for (const listing of listings) expect(listing.inputSchema).not.toHaveProperty("$schema");
  });

  test("an unknown tool and a bad input are tool errors", async () => {
    const unknown = await runToolOf(STUDIO_TOOLS, "no_tool", {}, contextOf({}));
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain("No tool");
    const bad = await runToolOf(STUDIO_TOOLS, "scene_command", { command: 3 }, contextOf({}));
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("scene_command: command");
  });

  test("a failed call of the frame is a tool error with the text of the frame", async () => {
    const calls: string[] = [];
    const result = await runToolOf(STUDIO_TOOLS, "studio_state", {}, contextOf({}, calls));
    expect(calls.length).toBeGreaterThan(0);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("no answer");
  });

  test("note_list lists the notes and note_resolve links the turn of the session", async () => {
    const note = (id: string, parent: string | null, annotation: object) => ({
      id,
      name: null,
      parent,
      tags: [],
      components: ["annotation"],
      local: null,
      world: null,
      bounds: null,
      values: { annotation },
    });
    const entities = [note("n1", "chair", { text: "Turn it" }), note("n2", null, { text: "Lamp", status: "done" })];
    const answers = { "scene.query": { matches: 2, total: 9, entities }, url: "http://x/", commandBatch: [] };
    const all = textOf(await runToolOf(STUDIO_TOOLS, "note_list", {}, contextOf(answers)));
    expect(all).toContain('n1 (on chair) · open · "Turn it"');
    expect(all).toContain('n2 (at a point) · done · "Lamp"');
    const open = textOf(await runToolOf(STUDIO_TOOLS, "note_list", { open: true }, contextOf(answers)));
    expect(open).not.toContain("n2");
    const sent: unknown[][] = [];
    const ctx: SceneToolContext = {
      session: { id: "s1", name: "Chairs", turn: 3 },
      surface: () => ({
        call: (call, args) => {
          if (call === "commandBatch") sent.push([...(args ?? [])]);
          return Promise.resolve(answers[call as keyof typeof answers]);
        },
      }),
    };
    const resolved = await runToolOf(STUDIO_TOOLS, "note_resolve", { note: "n1" }, ctx);
    expect(resolved.isError).toBeFalsy();
    const [steps] = sent[0] ?? [];
    expect(steps).toEqual([
      { command: "component.set", args: { entity: "n1", component: "annotation", field: "status", value: '"done"' } },
      { command: "component.set", args: { entity: "n1", component: "annotation", field: "task", value: '"s1#3"' } },
    ]);
  });

  test("reviveBytes turns each $bytes object into bytes", () => {
    const value = reviveBytes({ a: [{ $bytes: Buffer.from([1, 2, 3]).toString("base64") }], b: 4 }) as {
      a: Uint8Array[];
      b: number;
    };
    expect([...(value.a[0] ?? [])]).toEqual([1, 2, 3]);
    expect(value.b).toBe(4);
  });
});
