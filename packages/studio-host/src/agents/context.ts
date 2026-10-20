// SPDX-License-Identifier: Apache-2.0
/**
 * The context of a prompt: the chips that the person sees in the composer go with the prompt, and only they. Each chip
 * is one line of the context packet (`<studio-context>`). A picture chip (a file, or a region of the Scene view) goes
 * to the model as an image. The transcript keeps each chip of a prompt with no picture data. Thus the "Context" fold
 * of the turn lists the chips that the model got.
 */

/** The image types of a picture chip. */
export const CHIP_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ChipMime = (typeof CHIP_MIMES)[number];

/** A chip of the composer. */
export interface AgentChip {
  /** The kind: scene, selection, time, camera, panel, entity, asset, file, rule, sequence, command or picture. */
  readonly kind: string;
  readonly label: string;
  /** The line of the packet. */
  readonly text: string;
  /** The picture of a picture chip: its type and its base64 data. */
  readonly picture?: { readonly mime: ChipMime; readonly data: string };
}

/** A chip in the transcript: no picture data. */
export interface ChipLine {
  readonly kind: string;
  readonly label: string;
  readonly text: string;
  readonly picture: boolean;
}

/** The most chips of one prompt. */
export const CHIPS_MAX = 24;
/** The longest text of a chip (characters). */
const CHIP_TEXT_MAX = 2000;
/** The longest base64 data of a picture (about 3 MB). */
const PICTURE_MAX_CHARS = 4_000_000;

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** The chips of a request body: the good ones, cut, at most `CHIPS_MAX`. */
export function readChips(value: unknown): AgentChip[] {
  if (!Array.isArray(value)) return [];
  const out: AgentChip[] = [];
  for (const item of value.slice(0, CHIPS_MAX)) {
    if (typeof item !== "object" || item === null) continue;
    const { kind, label, text, picture } = item as Record<string, unknown>;
    if (typeof kind !== "string" || typeof label !== "string" || typeof text !== "string") continue;
    const chip = { kind: cut(kind, 40), label: cut(label, 200), text: cut(text, CHIP_TEXT_MAX) };
    const image = typeof picture === "object" && picture !== null ? (picture as Record<string, unknown>) : null;
    const mime = CHIP_MIMES.find((type) => type === image?.mime);
    const data = typeof image?.data === "string" && image.data.length <= PICTURE_MAX_CHARS ? image.data : null;
    out.push(mime === undefined || data === null ? chip : { ...chip, picture: { mime, data } });
  }
  return out;
}

/** The chips as the transcript keeps them. */
export function chipLines(chips: readonly AgentChip[]): ChipLine[] {
  return chips.map(({ kind, label, text, picture }) => ({ kind, label, text, picture: picture !== undefined }));
}

/** The context packet of the chips: one line each. Empty with no chip. */
export function contextPacket(chips: readonly AgentChip[]): string {
  if (chips.length === 0) return "";
  const lines = chips.map((chip) => `- ${chip.kind}: ${chip.text}${chip.picture === undefined ? "" : " (a picture)"}`);
  return ["<studio-context>", ...lines, "</studio-context>"].join("\n");
}
