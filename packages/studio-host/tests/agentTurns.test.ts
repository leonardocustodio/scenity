// SPDX-License-Identifier: Apache-2.0
// The turn records of the agent sessions. A write of a turn keeps the file before the write, and the session refuses
// a path out of the project. "Undo the turn" restores the files, deletes a new file, and asks the window to revert the
// document part. It also adds an `undone` item to the transcript.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptDriver } from "../src/agents/driver";
import { AgentSessions } from "../src/agents/sessions";
import { projectPath, TurnRecords } from "../src/agents/turns";
import { BridgeHub, type BridgeSocket } from "../src/bridgeHub";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-turns-"));
  dirs.push(dir);
  writeFileSync(join(dir, "notes.md"), "old notes\n");
  return dir;
}

/** Wait until the session has no turn that runs. */
async function idle(sessions: AgentSessions, id: string) {
  for (let i = 0; i < 200; i += 1) {
    const session = sessions.list().find((item) => item.id === id);
    if (session !== undefined && !session.running) return session.items;
    await Bun.sleep(5);
  }
  throw new Error("the turn did not end");
}

describe("the turn records", () => {
  test("keep the file before the first write of a turn and write it back", () => {
    const dir = project();
    const records = new TurnRecords();
    records.begin("s1", 1, "edit");
    expect(records.writeFile("s1", 1, dir, "notes.md", "new notes\n")).toBe("notes.md");
    records.writeFile("s1", 1, dir, "notes.md", "newer notes\n");
    records.writeFile("s1", 1, dir, join(dir, "plugins", "agent", "note.ts"), "export {};\n");
    expect(records.list("s1")[0]?.files).toEqual(["notes.md", "plugins/agent/note.ts"]);
    expect(() => records.writeFile("s1", 1, dir, "../outside.txt", "x")).toThrow("is not a file of the project");
    expect(() => projectPath(dir, dir)).toThrow("is not a file of the project");
    expect(records.revertFiles("s1", 1, dir)).toEqual(["notes.md", "plugins/agent/note.ts"]);
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("old notes\n");
    expect(existsSync(join(dir, "plugins", "agent", "note.ts"))).toBe(false);
    expect(records.list("s1")[0]?.undone).toBe(true);
  });

  test("Undo the turn reverts the files and asks the window for the document part", async () => {
    const dir = project();
    const hub = new BridgeHub();
    const calls: unknown[] = [];
    const socket: BridgeSocket = {
      send(text) {
        const message = JSON.parse(text) as { id: number; call?: string; args: unknown[] };
        // A presence message is not a call.
        if (message.call === undefined) return;
        calls.push([message.call, ...message.args]);
        queueMicrotask(() =>
          hub.message(
            socket,
            JSON.stringify({ workbench: 1, id: message.id, result: { steps: 2, dropped: 0, error: null } }),
          ),
        );
      },
    };
    hub.attach(socket);
    hub.message(socket, JSON.stringify({ type: "hello", project: "showroom", scene: "scenes/main.scene.json" }));
    const sessions = new AgentSessions({
      driver: scriptDriver({
        turns: [[{ write: { path: "notes.md", text: "agent notes\n" } }, { tool: "studio_state" }, { say: "done" }]],
      }),
      hub,
      dirOf: () => dir,
      emit: () => undefined,
    });
    const session = sessions.create("showroom", { mode: "auto" });
    sessions.prompt(session.id, "write the notes");
    await idle(sessions, session.id);
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("agent notes\n");
    expect(sessions.turnRecords(session.id)).toMatchObject([
      { turn: 1, prompt: "write the notes", files: ["notes.md"] },
    ]);
    const undone = await sessions.undoTurn(session.id, 1);
    expect(undone).toMatchObject({ kind: "undone", turn: 1, files: ["notes.md"], steps: 2, error: null });
    expect(calls.at(-1)).toEqual(["turn.undo", session.id, 1]);
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("old notes\n");
    expect(sessions.list()[0]?.items.at(-1)).toMatchObject({ kind: "undone" });
    expect(sessions.list()[0]?.items.find((item) => item.kind === "end")).toMatchObject({ turn: 1 });
  });

  test("a restore of a checkpoint puts each file back to its text at the start of that turn", () => {
    const dir = project();
    const records = new TurnRecords();
    for (const [turn, text] of [
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ] as const) {
      records.begin("s1", turn, `turn ${String(turn)}`);
      records.writeFile("s1", turn, dir, "notes.md", `${text}\n`);
      if (turn === 3) records.writeFile("s1", turn, dir, "late.md", "late\n");
    }
    expect(records.restoreFiles("s1", 2, dir)).toEqual(["late.md", "notes.md"]);
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("one\n");
    expect(existsSync(join(dir, "late.md"))).toBe(false);
    expect(() => records.restoreFiles("s1", 9, dir)).toThrow("No turn 9");
  });
});
