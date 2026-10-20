// SPDX-License-Identifier: Apache-2.0
// The project instructions: AGENTS.md, CLAUDE.md and the skills of `.scenity/skills/` go into each turn. An instruction
// ("never move the floor") changes the result of an agent that obeys its instructions (here, the script driver). The
// API reads the instructions and writes AGENTS.md.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@scenity/agent-tools";
import { z } from "zod";
import { scriptDriver } from "../src/agents/driver";
import { instructionsText, readInstructions, skillOf } from "../src/agents/instructions";
import type { AgentItem } from "../src/agents/protocol";
import { agentApi } from "../src/agents/routes";
import { AgentSessions } from "../src/agents/sessions";
import { BridgeHub } from "../src/bridgeHub";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(agents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-instructions-"));
  dirs.push(dir);
  if (agents !== undefined) writeFileSync(join(dir, "AGENTS.md"), agents);
  return dir;
}

const move = defineTool({
  name: "scene_command",
  description: "edit",
  input: z.object({ command: z.string().optional() }),
  alwaysLoad: false,
  handler: () => Promise.resolve({ content: [{ type: "text", text: "Applied" }] }),
});

/** The items of one turn of an agent that obeys the instructions. */
async function turnIn(dir: string): Promise<readonly AgentItem[]> {
  const sessions = new AgentSessions({
    driver: scriptDriver({
      turns: [
        [
          {
            when: "never move the floor",
            steps: [{ say: "The instructions keep the floor where it is." }],
            otherwise: [{ tool: "scene_command", input: { command: "entity.move" } }],
          },
        ],
      ],
    }),
    hub: new BridgeHub(),
    dirOf: () => dir,
    emit: () => undefined,
    tools: [move],
  });
  const session = sessions.create("showroom", { mode: "auto" });
  sessions.prompt(session.id, "tidy the room, the floor too");
  for (let i = 0; i < 400; i += 1) {
    if (sessions.list()[0]?.running === false) break;
    await Bun.sleep(5);
  }
  return sessions.list()[0]?.items ?? [];
}

describe("the project instructions", () => {
  test("an instruction changes the result of the agent", async () => {
    const without = await turnIn(project());
    expect(without.some((item) => item.kind === "tool")).toBe(true);
    const followed = await turnIn(project("# Rules\n\n- Never move the floor.\n"));
    expect(followed.some((item) => item.kind === "tool")).toBe(false);
    expect(followed.find((item) => item.kind === "text")).toMatchObject({
      text: "The instructions keep the floor where it is.",
    });
  });

  test("AGENTS.md, CLAUDE.md and the skills go into the instructions of a turn", () => {
    const dir = project("Never move the floor.\n");
    writeFileSync(join(dir, "CLAUDE.md"), "Use metres.\n");
    mkdirSync(join(dir, ".scenity", "skills"), { recursive: true });
    writeFileSync(
      join(dir, ".scenity", "skills", "light.md"),
      "# Product light\n\nLight a product shot with three lights.\n",
    );
    const text = instructionsText(readInstructions(dir));
    expect(text).toContain("## AGENTS.md\n\nNever move the floor.");
    expect(text).toContain("## CLAUDE.md\n\nUse metres.");
    expect(text).toContain("- Product light (.scenity/skills/light.md): Light a product shot with three lights.");
    expect(skillOf("plain.md", "no heading")).toEqual({
      file: ".scenity/skills/plain.md",
      name: "plain",
      use: "no heading",
    });
    expect(instructionsText(readInstructions(project()))).toBe("");
  });

  test("the API reads the instructions and writes AGENTS.md", async () => {
    const dir = project("old\n");
    const sessions = new AgentSessions({
      driver: scriptDriver({ turns: [[]] }),
      hub: new BridgeHub(),
      dirOf: () => dir,
      emit: () => undefined,
    });
    const dirOf = (key: string) => (key === "showroom" ? dir : null);
    const url = (path: string) => new URL(`http://studio${path}`);
    const read = await agentApi(
      sessions,
      new Request(url("/api/agent/instructions?project=showroom")),
      url("/api/agent/instructions?project=showroom"),
      dirOf,
    );
    expect(await read.json()).toMatchObject({ agents: "old\n", claude: null, skills: [] });
    const put = new Request(url("/api/agent/instructions"), {
      method: "PUT",
      body: JSON.stringify({ project: "showroom", agents: "Never move the floor.\n" }),
    });
    expect((await agentApi(sessions, put, url("/api/agent/instructions"), dirOf)).status).toBe(200);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("Never move the floor.\n");
    const missing = await agentApi(
      sessions,
      new Request(url("/api/agent/instructions?project=x")),
      url("/api/agent/instructions?project=x"),
      dirOf,
    );
    expect(missing.status).toBe(404);
  });
});
