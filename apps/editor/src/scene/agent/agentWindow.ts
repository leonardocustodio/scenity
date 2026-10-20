// SPDX-License-Identifier: Apache-2.0
/**
 * The context port of the agent panel over the editor window. The automatic chips read the editor, the selection, the
 * sequence, the viewport and the dock. The mentions read the providers of the search box (entities, files, assets,
 * commands) and the rules of the project. A region of the view crops the `@view` preview of the dev core.
 */
import type { Rule } from "@scenity/scene";
import { VIEW_PREVIEW } from "@scenity/runtime-dev/document/cameraPreview";
import { searchAll, type WindowSearch } from "../../studio/shell/search";
import type { ScenePageEditor } from "../sceneEditor";
import type { ViewportInfo, ViewportPort } from "../viewport/viewportTypes";
import { autoChips, fileKind, mentionChip, pictureChip, type AgentChip } from "./agentContext";
import type { AgentContextPort } from "./agentChips";
import { cropPicture, pickRegion } from "./viewRegion";
import type { InlineSources } from "./inlinePrompt";
import { pageReview } from "../review/reviewState";
import { checkpointDiff, checkpointOf } from "../review/checkpoints";
import { pageViewPreview } from "../review/viewPreview";
import { t } from "../../texts";

/** The parts of the window that the context port reads. */
export interface AgentWindowParts {
  readonly editor: ScenePageEditor;
  readonly canvas: HTMLCanvasElement;
  selection(): readonly string[];
  /** The open sequence and its time (ms), or null. */
  time(): { readonly sequence: string; readonly ms: number } | null;
  /** The current viewport (the camera that draws, its position and its target), or null. */
  view(): ViewportInfo | null;
  readonly viewport?: ViewportPort;
  /** The active panel of the dock, or null. */
  panel(): string | null;
  readonly search: WindowSearch;
  rules(): readonly Rule[];
  /** The title of a command of the window, or its ID. */
  commandTitle(id: string): string;
  /** Select entities and frame them. */
  show(ids: readonly string[]): void;
  /** Open the Review panel. */
  openReview(): void;
  /** The entity and the world point under a point of the canvas (CSS pixels), or null. */
  pick(x: number, y: number): Promise<{ readonly entity: string; readonly point: readonly number[] } | null>;
}

/** The search providers of each kind of mention. */
const MENTION_KINDS: Readonly<Record<string, string>> = {
  entities: "entity",
  assets: "asset",
  files: "file",
  commands: "command",
};
/** The maximum number of mentions in the list. */
const MENTIONS_MAX = 12;
/** The width of the picture of the view (pixels). */
const VIEW_PICTURE_WIDTH = 640;

/** The mention chips of a text: the results of the search providers and the rules. */
function mentions(parts: AgentWindowParts, query: string): AgentChip[] {
  const providers = parts.search.providers().filter((provider) => provider.id in MENTION_KINDS);
  const found = searchAll(providers, query).map((result) => {
    const base = MENTION_KINDS[result.provider] ?? result.provider;
    const kind = base === "file" ? fileKind(result.item.id) : base;
    return mentionChip(kind, result.item.id, result.item.label);
  });
  const words = query.toLowerCase();
  const rules = parts
    .rules()
    .filter((rule) => words === "" || rule.id.toLowerCase().includes(words) || rule.metric.includes(words))
    .map((rule) => mentionChip("rule", rule.id, rule.id));
  return [...found, ...rules].slice(0, MENTIONS_MAX);
}

/** The key of the view preview of a checkpoint. */
export function checkpointPreviewKey(session: string, turn: number): string {
  return `checkpoint:${session}#${String(turn)}`;
}

/** The chip of the result of the last review of a session (what the person accepted and rejected). */
function reviewChip(session: string | null): AgentChip[] {
  const text = session === null ? null : (pageReview()?.feedback(session) ?? null);
  // The result of the review is a Fluent text (review.ftl), as its label.
  return text === null
    ? []
    : [{ key: "auto:review", kind: "review", label: t("agent-chip-review"), text, words: true }];
}

/** The sources of the inline prompt over the window. */
export function inlineSources(parts: AgentWindowParts): InlineSources {
  const name = (id: string): string => parts.editor.doc.entities[id]?.name ?? id;
  return {
    selection: () => parts.selection(),
    name,
    fieldValue: (entity, component, field) => {
      let value: unknown = parts.editor.doc.entities[entity]?.components[component];
      for (const key of field === "" ? [] : field.split(".")) {
        value = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
      }
      return value;
    },
    pick: (x, y) => parts.pick(x, y),
    canvas: parts.canvas,
  };
}

/** The context port of the agent panel. */
export function agentContextPort(parts: AgentWindowParts): AgentContextPort {
  const sessionSets = (session: string) =>
    (pageReview()?.sets.value ?? []).filter((set) => set.actor.session === session);
  return {
    auto: (session) => [
      ...autoChips({
        scene: () => parts.editor.file.path,
        selection: () => parts.selection().map((id) => ({ id, name: parts.editor.doc.entities[id]?.name ?? id })),
        time: () => parts.time(),
        camera: () => {
          const view = parts.view();
          if (view === null) return null;
          const name = view.camera === "editor" ? "editor camera" : `camera ${view.camera}`;
          return {
            name,
            ...(view.position === null ? {} : { position: view.position }),
            ...(view.target === null ? {} : { target: view.target }),
          };
        },
        panel: () => parts.panel(),
      }),
      ...reviewChip(session),
    ],
    mentions: (query) => mentions(parts, query),
    entity: (id) => mentionChip("entity", id, parts.editor.doc.entities[id]?.name ?? id),
    names: {
      command: (id) => parts.commandTitle(id),
      entity: (id) => parts.editor.doc.entities[id]?.name ?? id,
    },
    known: (id) => Object.hasOwn(parts.editor.doc.entities, id),
    show: (ids) => parts.show(ids),
    waiting: (session) => sessionSets(session).reduce((total, set) => total + set.ops.length, 0),
    openReview: () => parts.openReview(),
    checkpointDiff: (session, turn) => checkpointDiff(parts.editor, session, turn),
    previewCheckpoint: (session, turn, on) => {
      const preview = pageViewPreview();
      const doc = checkpointOf(session, turn);
      if (!on || doc === null) preview?.hide();
      else preview?.show(checkpointPreviewKey(session, turn), doc);
    },
    previewKey: () => pageViewPreview()?.key.value ?? null,
    acceptAll: (session) => {
      const review = pageReview();
      for (const set of sessionSets(session)) {
        const reason =
          review?.accept(
            set,
            set.ops.map((op) => op.key),
          ) ?? null;
        if (reason !== null) return reason;
      }
      return null;
    },
    region: async () => {
      const { viewport } = parts;
      if (viewport === undefined) return null;
      const region = await pickRegion(parts.canvas);
      if (region === null) return null;
      const bitmap = await viewport.previewCamera(VIEW_PREVIEW, VIEW_PICTURE_WIDTH);
      if (bitmap === null) return null;
      return pictureChip(await cropPicture(bitmap, region), t("agent-chip-region"));
    },
  };
}
