// SPDX-License-Identifier: Apache-2.0
// The embed snippets of a built player: the web component, a script tag and Vue, with the player options. Also a plain
// page with the web component.
import { describe, expect, it } from "vitest";
import { embedPage, embedSnippet } from "../../src/scene/build/embedSnippet";

const options = { base: "https://example.com/show/", camera: "front", tier: "", autoplay: true, loop: true };

describe("the embed snippets", () => {
  it("gives the web component, a script tag and Vue with the options", () => {
    expect(embedSnippet("element", options)).toBe(
      [
        '<script type="module" src="https://example.com/show/player/element.js"></script>',
        '<scenity-player src="https://example.com/show/project/scenity.project.json" camera="front" autoplay loop style="display:block;width:100%;aspect-ratio:16/9"></scenity-player>',
      ].join("\n"),
    );
    const script = embedSnippet("script", options);
    expect(script).toContain('await import("https://example.com/show/player/element.js");');
    expect(script).toContain('player.setAttribute("camera", "front");');
    expect(script).toContain('player.setAttribute("autoplay", "");');
    const vue = embedSnippet("vue", { ...options, camera: 'a"b' });
    expect(vue).toContain(
      '<ScenityPlayer project="https://example.com/show/project/scenity.project.json" camera="a&quot;b" autoplay loop',
    );
    expect(embedPage({ base: "./" })).toContain('<scenity-player src="./project/scenity.project.json"');
  });
});
