// SPDX-License-Identifier: Apache-2.0
/**
 * The plugin types of the editor core: the shapes of the values that the core
 * reads from the editor face of a plugin (the take model, the content browser, the layout checks, the scene input, the
 * inspect report, the metric values, the room kit). The core reads its plugin types from `virtual:scenity/editor-types`
 * (src/plugins.ts). The tsconfig.json of the editor points that name at this module, so the core type-checks with no
 * plugin. A plugin outside the checkout points the name at its editor face, so the check reads the core with the
 * types of that plugin. The types of a plugin must have at least the fields of these types.
 */
import type { Vec3 } from "@scenity/character/math";
import type { CameraSpec, SafeBox } from "@scenity/runtime/camera";
import type { SceneClient } from "@scenity/runtime/client";
import type { InspectReport as DevInspectReport } from "@scenity/runtime-dev/inspect";
import type { MetricValue as DevMetricValue } from "@scenity/runtime-dev/metrics";
import type { IndexShot as DevIndexShot } from "@scenity/runtime-dev/shots";
import type { NamedView } from "./cameras";

/**
 * The names of a plugin. A plugin gives string literal types. These types are strings with a mark. Thus a plain string
 * also needs a cast to a name type here, as with the types of a plugin.
 */
/** The name of a sequence of the plugin (a take). */
export type PresetName = string & { readonly __name: "presetName" };
/** The name of a debug layer of the plugin. */
export type DebugLayer = string & { readonly __name: "debugLayer" };
/** The name of a metric of the plugin. */
export type MetricName = string & { readonly __name: "metricName" };
/** The name of a socket of a prop. */
export type SocketName = string & { readonly __name: "socketName" };

/** The place of a prop on the floor of the room and its turn. */
export interface PropPlace {
  readonly at: readonly [number, number, number];
  readonly yaw: number;
}

/**
 * One event of a take at the time `at` (ms). The core reads two kinds: a member goes to a place (`place`), and a prop
 * is at a place from this time (`prop`; with a null place, the prop returns to its tuned place). The core shows the
 * other events by their kind only.
 */
export type LabEvent =
  | { readonly at: number; readonly kind: "place"; readonly member: string; readonly to: string }
  | { readonly at: number; readonly kind: "prop"; readonly slot: string; readonly place: PropPlace | null }
  | { readonly at: number; readonly kind: OtherEventKind; readonly member?: string };

/** The kinds of the other events: the core shows them by their kind (a plugin can have more kinds). */
export type OtherEventKind = "preset" | "act" | "phase" | "walk" | "member" | "swap" | "stop" | "reset" | "other";

/** A member of the state of a take. */
export interface LabMember {
  readonly id: string;
}

/** The state of a take at a time. */
export interface LabState {
  readonly members: readonly LabMember[];
}

/** The scene input of the plugin: the core gives it to the renderer as it is. */
export type SceneInput = object;

/** The inspect report of a frame. */
export type InspectReport = DevInspectReport;

/** One metric value of a frame. */
export type MetricValue = DevMetricValue<MetricName>;

/** A picture of the frame index with its inspect report. */
export type IndexShot = DevIndexShot;

/** The scene of an item of the content browser: what the lab plays when the item opens. */
export interface ItemScene {
  readonly take: PresetName;
  readonly events: readonly LabEvent[];
  readonly window: { readonly from: number; readonly to: number };
  readonly moment: number;
  readonly camera: string | NamedView;
  readonly cast: string | null;
  readonly exact: boolean;
  readonly assets: boolean;
}

/** A clip of the animation catalog of an item. */
export interface BrowserClip {
  readonly id: string;
  readonly title: string;
  readonly section: string;
  readonly family: string | null;
  readonly kind: string | null;
  readonly layers: readonly string[];
  readonly status: string;
  readonly priority: string | null;
  readonly summary: string;
}

/** A sequence of the animation catalog of an item, with its tracks of clips. */
export interface BrowserPreset {
  readonly priority: string | null;
  readonly trigger: string;
  readonly tracks: readonly { readonly track: string; readonly clips: readonly string[] }[];
}

/** A node of the tree of the content browser. */
export interface BrowserItem {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly subtitle: string;
  readonly path: readonly string[];
  readonly children: readonly BrowserItem[];
  readonly scene: ItemScene | null;
  readonly still: string | null;
  readonly clip?: BrowserClip;
  readonly preset?: BrowserPreset;
  readonly owner?: string;
}

/** The tree of the content browser. */
export interface BrowserTree {
  readonly roots: readonly BrowserItem[];
  readonly byKey: ReadonlyMap<string, BrowserItem>;
}

/** A layout check with its status. */
export interface LayoutCheck {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
  readonly limit: string;
  readonly provisional: boolean;
  readonly pass: boolean;
  readonly reason: string;
  readonly status: "pass" | "known" | "fail";
  readonly code: number | null;
}

/** The report of the layout checks. */
export interface LayoutReport {
  readonly checks: readonly LayoutCheck[];
  readonly failed: readonly LayoutCheck[];
  readonly known: readonly LayoutCheck[];
  readonly summary: string;
  readonly notes: readonly string[];
}

/** The checks of a proposal against the current scene. */
export interface ProposalLayout {
  readonly breaks: readonly LayoutCheck[];
  readonly mends: readonly LayoutCheck[];
  readonly report: LayoutReport;
}

/** The layout checks of the page. */
export interface LayoutChecks {
  readonly report: { readonly value: LayoutReport };
  check(input?: object): LayoutReport;
  gate(override?: string): string | null;
  takeOverride(): string | null;
  readonly expanded: { readonly value: boolean };
  setExpanded(open: boolean): void;
}

/** One check of a save. */
export interface SaveCheck {
  readonly id: string;
  readonly status: "pass" | "fail" | "note";
  readonly text: string;
  readonly lines: readonly string[];
}

/** The live source of a plugin (a mock engine), or the state of its connection. */
export type LabMock = object;

/** The methods of the script API that the plugin adds. */
export interface PluginLabApi {
  measure(): Promise<MetricValue[]>;
  measureAt(times: number[], options?: object): Promise<{ simMs: number | null; values: MetricValue[] }[]>;
}

/** A built prop of the asset manifest. */
export interface ManifestProp {
  readonly id: string;
  readonly slot: string;
  readonly rights: string;
  readonly tiers: Readonly<Record<"high" | "low", { readonly file: string; readonly bytes: number }>>;
}

/** The asset manifest of the plugin as the core reads it. */
export interface Room3DManifest {
  readonly props: readonly ManifestProp[];
}

/** The renderer of the plugin. */
export type Room3DRenderer = SceneClient<SceneInput>;

/** The room kit of the plugin: the camera, the safe frame and the sockets of the props. */
export interface RoomKit {
  readonly camera: CameraSpec;
  readonly safeFrame: readonly SafeBox[];
  readonly sockets: Readonly<Record<string, Readonly<Record<string, Vec3>>>>;
}

/** The light of the room. */
export type RoomLight = object;
