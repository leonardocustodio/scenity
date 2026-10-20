// SPDX-License-Identifier: Apache-2.0
/**
 * The project of the host in `host.hello`. The host reads the project manifest
 * `scenity.project.json` (`@scenity/scene` `projectSchema`) of its project folder, or uses the built-in manifest of
 * the lab of this checkout (project.ts). The module is pure, so the page gets it through
 * `@scenity/workbench-host/protocol`.
 */
import type { AuthProviderKind, Role } from "./roleProtocol";

/** One surface of the manifest: its ID, its kind (`scene`, `web`, `console`, `gallery` or a plugin kind), its label. */
export interface ProjectSurfaceInfo {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  /** What the page of the surface can do (`SCENE_CAPABILITY`, `INDEX_CAPABILITY` or a plugin capability). */
  readonly capabilities: readonly string[];
  /** The start path of the frame on the server of the surface, or null for `/`. */
  readonly page: string | null;
  /** A hidden surface runs, but it has no tab and no key. */
  readonly hidden: boolean;
  /** The place of the tab (the manifest order, else the place in the list). */
  readonly order: number;
}

/**
 * The capability of a surface whose page has the scene bridge (the lab API of apps/editor). The tools, the
 * context packet, the shadow frame, the clock link and the detached windows use the first surface with it.
 */
export const SCENE_CAPABILITY = "scene";
/** The capability of a surface whose frames fill the frame index (the shadow indexer, the indexer window). */
export const INDEX_CAPABILITY = "index";
/** The error of a request for the scene surface in a project that has none. */
export const NO_SCENE_SURFACE = "The project has no surface with the capability scene.";
/** The count of the surface keys (⌘1 to ⌘9). */
export const SURFACE_KEY_COUNT = 9;

/** True when a surface has a capability. A surface with no list has no capability. */
export function hasCapability(surface: { readonly capabilities?: readonly string[] }, capability: string): boolean {
  return surface.capabilities?.includes(capability) === true;
}

/** The first surface with a capability (default: the scene capability), or null. */
export function surfaceWith<T extends { readonly capabilities?: readonly string[] }>(
  surfaces: readonly T[],
  capability: string = SCENE_CAPABILITY,
): T | null {
  return surfaces.find((surface) => hasCapability(surface, capability)) ?? null;
}

/** The surfaces of the tabs: the surfaces that are not hidden, by order (a tie keeps the manifest order). */
export function surfaceTabs<T extends Pick<ProjectSurfaceInfo, "hidden" | "order">>(surfaces: readonly T[]): T[] {
  return surfaces.filter((surface) => !surface.hidden).sort((a, b) => a.order - b.order);
}

/** The workbench part of the project, with the defaults filled in. */
export interface ProjectInfo {
  readonly id: string;
  readonly name: string;
  /** The absolute path of the project folder. */
  readonly dir: string;
  /** The absolute path of `scenity.project.json`, or null for the built-in manifest. */
  readonly manifest: string | null;
  readonly surfaces: readonly ProjectSurfaceInfo[];
  /** The runs of the Runs tab: a name and a command line. */
  readonly runs: Readonly<Record<string, string>>;
  /** The command that prepares a new checkout, or null. */
  readonly setup: string | null;
  /** The command that a turn of an agent must pass before it ends, or null. */
  readonly gate: string | null;
  /** The content roots of the frame index, relative to the checkout. */
  readonly contentRoots: readonly string[];
  /** The path patterns of the project that the workbench never shows (added to the denylist of the host). */
  readonly denylist: readonly string[];
  /** The file of the API key of the chat mode, relative to the project folder. */
  readonly credentialFile: string;
  /** The theme of the page (`navy`, `light`, `dark`), or null for the choice of the page. */
  readonly theme: string | null;
  /**
   * The sequence that the forms of the dock start with (the review pack, the picker, a background run): the
   * default of a host plugin, else the first sequence of the project document, else null (absent: an old host).
   */
  readonly defaultSequence?: string | null;
}

/** The parts of `host.hello` for the project and the access: the project, Git, the role and the auth provider. */
export interface HelloAccess {
  readonly project: ProjectInfo;
  /** False for a folder with no Git: the page has no Changes tab, and the host keeps no turns. */
  readonly git: boolean;
  /** The role of the token of this page. */
  readonly role: Role;
  readonly auth: AuthProviderKind;
  /** True behind the Scenity gateway (remote.ts). */
  readonly remote: boolean;
}

/** The error of a Git request in a folder with no Git. */
export const NO_GIT = "This project folder has no Git: the workbench has no changes, commits or turns here.";
