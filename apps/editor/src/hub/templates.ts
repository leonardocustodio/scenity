// SPDX-License-Identifier: Apache-2.0
/**
 * The templates of the new project wizard of the Hub: the two templates of `scenity create` and the samples of the
 * checkout (`sample:<name>`). The texts are the Fluent messages `hub-template-<text>` and `hub-template-<text>-about`.
 * The picture is the poster of the sample on the scene server.
 */

export interface HubTemplate {
  /** The `--template` value of `scenity create`. */
  readonly id: string;
  /** The Fluent ID part of the name and the description. */
  readonly text: string;
  readonly picture: string | null;
  /** True for a template that only a checkout has (its files come from the samples). */
  readonly checkoutOnly: boolean;
}

const poster = (sample: string, file: string): string => `/projects/${sample}/posters/${file}`;

export const HUB_TEMPLATES: readonly HubTemplate[] = [
  { id: "empty", text: "empty", picture: null, checkoutOnly: false },
  { id: "showroom", text: "showroom", picture: poster("showroom", "main.webp"), checkoutOnly: false },
  { id: "sample:characters", text: "characters", picture: poster("characters", "main.webp"), checkoutOnly: true },
  { id: "sample:walkthrough", text: "walkthrough", picture: poster("walkthrough", "plaza.webp"), checkoutOnly: true },
  { id: "sample:sim-road", text: "sim-road", picture: poster("sim-road", "road.webp"), checkoutOnly: true },
  { id: "sample:physics", text: "physics", picture: null, checkoutOnly: true },
  { id: "sample:spin", text: "spin", picture: null, checkoutOnly: true },
  { id: "sample:gltf-samples", text: "gltf-samples", picture: null, checkoutOnly: true },
];

/** A project ID from a name: letters, digits, `_` and `-` only (the rule of `scenity create`). */
export function folderName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);
}
