// SPDX-License-Identifier: Apache-2.0
/**
 * The chips of the composer of the agent panel. Each chip is one line of the context packet of a prompt. The person
 * sees each chip and removes one with ✕. The kinds of chips are:
 *
 * - the automatic chips: the scene, the selection, the time, the camera and the panel;
 * - mentions (`@` in the composer, or a drag of a hierarchy row or an asset tile): an entity, an asset, a file, a
 *   sequence, a rule or a command, with a stable reference (`entity:<id>`, `asset:<id>`, a path);
 * - pictures: a picture file, or a region of the Scene view.
 */
import { CORE_PANELS } from "../../studio/shell/panels";
import { t } from "../../texts";

/** A chip of the composer. */
export interface AgentChip {
  /** The key of the chip (one chip per key): `auto:selection`, `entity:table`, `picture:2`. */
  readonly key: string;
  readonly kind: string;
  readonly label: string;
  /** The line of the context packet (for the agent, in English). */
  readonly text: string;
  /** The tooltip of the chip for the person (a Fluent text). With no tooltip, the chip shows the line of the packet. */
  readonly title?: string;
  /** True when the label and the title are Fluent texts; else they are data (names, paths). */
  readonly words?: boolean;
  /** True for an automatic chip. */
  readonly auto?: boolean;
  readonly picture?: { readonly mime: "image/png" | "image/jpeg" | "image/webp"; readonly data: string };
}

/** What the automatic chips read of the window. */
export interface ContextSources {
  /** The path of the open scene. */
  scene(): string | null;
  /** The selected entities, the primary first. */
  selection(): readonly { readonly id: string; readonly name: string }[];
  /** The open sequence and its time (ms), or null. */
  time(): { readonly sequence: string; readonly ms: number } | null;
  /** The camera of the Scene view: the editor camera pose, or the document camera. */
  camera(): {
    readonly name: string;
    readonly position?: readonly number[];
    readonly target?: readonly number[];
  } | null;
  /** The active panel, or null. */
  panel(): string | null;
}

const vec = (value: readonly number[]): string => `(${value.map((part) => Number(part.toFixed(2))).join(", ")})`;

/** The current automatic chips. */
export function autoChips(sources: ContextSources): AgentChip[] {
  const chips: AgentChip[] = [];
  const scene = sources.scene();
  if (scene !== null)
    chips.push({ key: "auto:scene", kind: "scene", label: scene.split("/").at(-1) ?? scene, text: scene });
  const selected = sources.selection();
  if (selected.length > 0) {
    const names = selected.map((item) => (item.name === item.id ? item.id : `${item.id} (${item.name})`));
    const one = selected.length === 1;
    const label = one ? (selected[0]?.name ?? "") : t("agent-chip-selected", { count: selected.length });
    const text = names.join(", ");
    chips.push({
      key: "auto:selection",
      kind: "selection",
      label,
      text,
      ...(one ? {} : { title: t("agent-chip-selected-title", { names: text }), words: true }),
    });
  }
  const time = sources.time();
  if (time !== null) {
    const seconds = Number((time.ms / 1000).toFixed(2));
    chips.push({
      key: "auto:time",
      kind: "time",
      label: `t=${String(seconds)} s`,
      text: `${String(seconds)} s in ${time.sequence}`,
      title: t("agent-chip-time-title", { seconds, sequence: time.sequence }),
      words: true,
    });
  }
  const camera = sources.camera();
  if (camera !== null) {
    const pose =
      camera.position === undefined || camera.target === undefined
        ? ""
        : ` at ${vec(camera.position)} looking at ${vec(camera.target)}`;
    chips.push({
      key: "auto:camera",
      kind: "camera",
      label: t("agent-chip-camera"),
      text: `${camera.name}${pose}`,
      title: t("agent-chip-camera-title", { camera: camera.name }),
      words: true,
    });
  }
  const panel = sources.panel();
  if (panel !== null) {
    // A panel of the window shows its title; a panel of a plugin shows its ID (data).
    const spec = CORE_PANELS.find((item) => item.id === panel);
    const label = spec === undefined ? panel : t(spec.title);
    chips.push({
      key: "auto:panel",
      kind: "panel",
      label,
      text: `the person looks at the ${panel} panel`,
      title: t("agent-chip-panel-title", { panel: label }),
      words: spec !== undefined,
    });
  }
  return chips;
}

/** The chips of the composer: the automatic chips (but not the muted ones), then the added chips. */
export function composerChips(
  auto: readonly AgentChip[],
  muted: ReadonlySet<string>,
  added: readonly AgentChip[],
): AgentChip[] {
  const keys = new Set<string>();
  const out: AgentChip[] = [];
  for (const chip of [...auto.filter((item) => !muted.has(item.key)), ...added]) {
    if (keys.has(chip.key)) continue;
    keys.add(chip.key);
    out.push(chip);
  }
  return out;
}

/** The kind of a mention of a file: a sequence file, a scene file or another file. */
export function fileKind(path: string): string {
  if (path.endsWith(".sequence.json")) return "sequence";
  if (path.endsWith(".scene.json")) return "scene-file";
  return "file";
}

/** A mention chip with its stable reference. */
export function mentionChip(kind: string, id: string, label: string): AgentChip {
  const ref = kind === "file" || kind === "sequence" || kind === "scene-file" ? id : `${kind}:${id}`;
  return { key: `${kind}:${id}`, kind, label, text: label === id ? ref : `${ref} "${label}"` };
}

export { ENTITY_DRAG_TYPE } from "../hierarchy/hierarchyUi";

/** The base64 text of bytes. */
export function base64Of(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

let pictures = 0;

/** A picture chip of a file (PNG, JPEG or WebP), or null for another file. */
export async function pictureChip(file: Blob & { readonly name?: string }, label?: string): Promise<AgentChip | null> {
  const mime = file.type;
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") return null;
  const data = base64Of(new Uint8Array(await file.arrayBuffer()));
  pictures += 1;
  const name = label ?? file.name ?? t("agent-chip-picture");
  return { key: `picture:${String(pictures)}`, kind: "picture", label: name, text: name, picture: { mime, data } };
}
