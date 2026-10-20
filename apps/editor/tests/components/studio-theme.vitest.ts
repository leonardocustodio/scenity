// SPDX-License-Identifier: Apache-2.0
// The theme of the editor window: the choice of the browser immediately, and the host preferences in the studio. Also a
// change that goes to both, the theme on the body and the contrast on the root element.
import { afterEach, describe, expect, it } from "vitest";
import { themeCommands } from "../../src/scene/shellHost";
import { applyTheme, PageTheme, THEME_KEY, themeChoice } from "../../src/studio/shell/theme";

function storage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  } as Storage;
}

afterEach(() => {
  delete document.body.dataset.theme;
  delete document.documentElement.dataset.contrast;
});

describe("the theme of the editor window", () => {
  it("reads a choice, else the default", () => {
    expect(themeChoice({ theme: "navy", contrast: "more" })).toEqual({ theme: "navy", contrast: "more" });
    expect(themeChoice({ theme: "pink" })).toEqual({ theme: "dark", contrast: "standard" });
    expect(themeChoice(null)).toEqual({ theme: "dark", contrast: "standard" });
  });

  it("puts the theme on the body and the contrast on the root element", () => {
    applyTheme({ theme: "light", contrast: "more" });
    expect(document.body.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.contrast).toBe("more");
  });

  it("starts with the choice of the browser, takes the host preferences, and keeps a change in both", async () => {
    const local = storage({ [THEME_KEY]: JSON.stringify({ theme: "light", contrast: "standard" }) });
    const theme = new PageTheme(() => local);
    expect(theme.start()).toEqual({ theme: "light", contrast: "standard" });
    expect(document.body.dataset.theme).toBe("light");
    const puts: unknown[] = [];
    const fetcher = (_input: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === "PUT") puts.push(JSON.parse(typeof init.body === "string" ? init.body : "{}"));
      return Promise.resolve(
        new Response(JSON.stringify({ format: "x", theme: "navy", contrast: "more", locale: "en-US" })),
      );
    };
    await theme.useHost(fetcher);
    expect(theme.choice.value).toEqual({ theme: "navy", contrast: "more" });
    expect(document.documentElement.dataset.contrast).toBe("more");
    await theme.set({ contrast: "standard" });
    expect(puts.at(-1)).toMatchObject({ theme: "navy", contrast: "standard", locale: "en-US" });
    expect(JSON.parse(local.getItem(THEME_KEY) ?? "{}")).toEqual({ theme: "navy", contrast: "standard" });
  });

  it("has a command for each theme and one for the contrast", async () => {
    const theme = new PageTheme(() => storage());
    theme.start();
    const commands = themeCommands(theme);
    expect(commands.map((command) => command.id)).toEqual([
      "theme.dark",
      "theme.light",
      "theme.navy",
      "theme.contrast",
    ]);
    await commands.find((command) => command.id === "theme.navy")?.run({});
    await commands.find((command) => command.id === "theme.contrast")?.run({});
    expect(theme.choice.value).toEqual({ theme: "navy", contrast: "more" });
    expect(document.body.dataset.theme).toBe("navy");
  });
});
