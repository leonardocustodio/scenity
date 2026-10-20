// SPDX-License-Identifier: Apache-2.0
// The ghosts of the changes that wait: the hex colour of the session of a change, and the sender that sends a spec only
// when the ghosts change.
import { describe, expect, it } from "vitest";
import { ghostSender, hexColour } from "../../src/scene/viewport/ghosts";

describe("the ghosts of the changes that wait", () => {
  it("take the colour of the token of the session, else the colour of the actor", () => {
    const tokens: Record<string, string> = { "--sc-color-studio-agent-2": " #0ea5e9" };
    const read = (token: string): string => tokens[token] ?? "";
    expect(hexColour("var(--sc-color-studio-agent-2)", read)).toBe("#0ea5e9");
    expect(hexColour("#123456", read)).toBe("#123456");
    expect(hexColour("var(--sc-color-unknown)", read)).toBe("#7c3aed");
  });

  it("send a spec only when it changes, and null for no ghost", () => {
    const sent: unknown[] = [];
    const send = ghostSender((spec) => sent.push(spec));
    const one = { copies: [{ entity: "chair", matrix: [1], colour: "#7c3aed" }] };
    send(one);
    send({ copies: [...one.copies] });
    send({ copies: [] });
    send({ copies: [] });
    expect(sent).toEqual([one, null]);
  });
});
