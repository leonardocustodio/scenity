// SPDX-License-Identifier: Apache-2.0
// The tools of the agent sessions. The command line of a job becomes its typed arguments, and an agent starts only its
// job commands. Ask refuses job_run, and the pictures of a tool result go to the picture store.
import { describe, expect, test } from "bun:test";
import { defineTool, imageContent } from "@scenity/agent-tools";
import { z } from "zod";
import { scriptDriver } from "../src/agents/driver";
import { argsRecord, studioJobPort } from "../src/agents/jobPort";
import { PictureStore, PICTURES_MAX } from "../src/agents/pictures";
import { AgentSessions } from "../src/agents/sessions";
import { BridgeHub } from "../src/bridgeHub";
import { JobService } from "../src/jobs";

/** Wait until the session has no turn that runs. */
async function idle(sessions: AgentSessions, id: string) {
  for (let i = 0; i < 200; i += 1) {
    const session = sessions.list().find((item) => item.id === id);
    if (session !== undefined && !session.running) return session.items;
    await Bun.sleep(5);
  }
  throw new Error("the turn did not end");
}

describe("the job port of the agent sessions", () => {
  test("reads a command line into the typed arguments of the job", () => {
    expect(argsRecord("check", ["--scene", "scenes/main.scene.json", "--json"])).toEqual({
      scene: "scenes/main.scene.json",
      json: true,
    });
    expect(argsRecord("shot", ["--camera=front,top", "--at", "1200"])).toEqual({ camera: ["front", "top"], at: 1200 });
    expect(argsRecord("assets.used-by", ["chair"])).toEqual({ id: "chair" });
    expect(() => argsRecord("check", ["--fly"])).toThrow("check has no flag --fly");
    expect(() => argsRecord("check", ["--scene"])).toThrow("--scene needs a value");
    expect(() => argsRecord("check", ["extra"])).toThrow("check takes no more values");
  });

  test("starts only the job commands of an agent", () => {
    const port = studioJobPort(new JobService(), "/tmp/none", "showroom");
    expect(() => port.start("git.clone", ["https://example.com/x.git", "x"])).toThrow(
      "an agent does not start git.clone",
    );
    expect(port.info("job-404")).toBeNull();
    expect(port.output("job-404", 10)).toBeNull();
  });
});

describe("the tool rules of the agent sessions", () => {
  test("Ask refuses job_run; the pictures of a result go to the store", async () => {
    const picture = defineTool({
      name: "scene_frame",
      description: "A picture.",
      input: z.object({}),
      alwaysLoad: false,
      handler: () =>
        Promise.resolve({ content: [imageContent({ bytes: new Uint8Array([1, 2, 3]), mime: "image/webp" })] }),
    });
    const run = defineTool({
      name: "job_run",
      description: "A run.",
      input: z.object({}),
      alwaysLoad: false,
      handler: () => Promise.resolve({ content: [{ type: "text", text: "started" }] }),
    });
    const sessions = new AgentSessions({
      driver: scriptDriver({ turns: [[{ tool: "scene_frame" }, { tool: "job_run" }]] }),
      hub: new BridgeHub(),
      dirOf: () => null,
      emit: () => undefined,
      tools: [picture, run],
    });
    const session = sessions.create("showroom", { mode: "ask" });
    sessions.prompt(session.id, "look");
    const items = await idle(sessions, session.id);
    const frame = items[1];
    const ids = frame?.kind === "tool" ? frame.pictures : [];
    expect(ids).toHaveLength(1);
    expect([...(sessions.pictures.get(ids[0] ?? "")?.bytes ?? [])]).toEqual([1, 2, 3]);
    expect(items[2]).toMatchObject({ kind: "tool", name: "job_run", isError: true });
  });

  test("the picture store keeps the newest pictures", () => {
    const store = new PictureStore();
    const first = store.put(new Uint8Array([0]), "image/png");
    for (let i = 0; i < PICTURES_MAX; i += 1) store.put(new Uint8Array([i % 255]), "image/png");
    expect(store.get(first)).toBeNull();
    expect(store.get(`p${String(PICTURES_MAX + 1)}`)?.mime).toBe("image/png");
  });
});
