// SPDX-License-Identifier: Apache-2.0
/**
 * The embed snippets of a built player, each with the player options. The kinds are the web component
 * (`<scenity-player>` and the module `player/element.js` of the build), a script tag that makes the element, and the
 * Vue component of `@scenity/player`. Pure functions, no DOM.
 */

/** The options of an embed: the attributes of `<scenity-player>` (the props of the Vue component). */
export interface EmbedOptions {
  /** The URL of the build folder, with a "/" at the end ("./" when the page is in the build folder). */
  readonly base: string;
  readonly scene?: string;
  readonly sequence?: string;
  readonly camera?: string;
  readonly tier?: string;
  readonly backend?: string;
  readonly autoplay?: boolean;
  readonly loop?: boolean;
  readonly muted?: boolean;
}

/** The kinds of snippets. */
export const SNIPPET_KINDS = ["element", "script", "vue"] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];

/** The attributes of the element, in a fixed order. */
function attributes(options: EmbedOptions): [string, string | true][] {
  const out: [string, string | true][] = [["src", `${options.base}project/scenity.project.json`]];
  for (const key of ["scene", "sequence", "camera", "tier", "backend"] as const) {
    const value = options[key]?.trim();
    if (value !== undefined && value !== "") out.push([key, value]);
  }
  for (const key of ["autoplay", "loop", "muted"] as const) if (options[key] === true) out.push([key, true]);
  return out;
}

const quote = (value: string): string => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/** The snippet of a kind. */
export function embedSnippet(kind: SnippetKind, options: EmbedOptions): string {
  const attrs = attributes(options);
  if (kind === "element") {
    const html = attrs.map(([key, value]) => (value === true ? key : `${key}="${quote(value)}"`)).join(" ");
    return [
      `<script type="module" src="${quote(`${options.base}player/element.js`)}"></script>`,
      `<scenity-player ${html} style="display:block;width:100%;aspect-ratio:16/9"></scenity-player>`,
    ].join("\n");
  }
  if (kind === "script") {
    const sets = attrs.map(
      ([key, value]) =>
        `  player.setAttribute(${JSON.stringify(key)}, ${JSON.stringify(value === true ? "" : value)});`,
    );
    return [
      '<script type="module">',
      `  await import(${JSON.stringify(`${options.base}player/element.js`)});`,
      '  const player = document.createElement("scenity-player");',
      ...sets,
      '  player.style.cssText = "display:block;width:100%;aspect-ratio:16/9";',
      "  document.body.append(player);",
      "</script>",
    ].join("\n");
  }
  const props = attrs.map(([key, value]) => {
    if (key === "src") return `project="${quote(value as string)}"`;
    return value === true ? key : `${key}="${quote(value)}"`;
  });
  return [
    "<script setup>",
    'import { ScenityPlayer } from "@scenity/player/vue";',
    "</script>",
    "",
    "<template>",
    `  <ScenityPlayer ${props.join(" ")} style="width:100%;aspect-ratio:16/9" />`,
    "</template>",
  ].join("\n");
}

/** A whole HTML page with the web component snippet: the preview of the panel, and a plain file of a test. */
export function embedPage(options: EmbedOptions, title = "Scenity player"): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    `<head><meta charset="UTF-8" /><title>${quote(title)}</title></head>`,
    '<body style="margin:0;background:#000">',
    embedSnippet("element", options),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
