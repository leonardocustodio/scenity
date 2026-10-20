// SPDX-License-Identifier: Apache-2.0
/**
 * The names and the doc lines of new named cameras. The command `camera.save` of the lab and the writer `labs
 * camera-save` (the lab CLI of the plugin) share these rules. A name is a key of the cameras of the plugin
 * (cameras.ts). It has small letters and digits, with a hyphen between parts, for example `side-right`. The lab and
 * the tool check the same rules, so the tool writes each name that the lab accepts.
 *
 * This module has no Vue import, because the tools and the tests read it. The problem texts are Fluent messages of
 * `src/i18n/en-US/lab-core.ftl`, and the camera save form shows them. The default doc line goes into a source file of
 * the plugin, so it stays in English.
 */
import { t } from "../texts";
import { parseView, viewText, type NamedView } from "./cameras";

/** The tool of the source operation of `camera.save`. The host runs it as a run of the Runs tab. */
export const CAMERA_SAVE_TOOL = "labs camera-save";

/** The longest name of a camera, and the longest doc line. With these limits, the doc line fits in 120 characters. */
const NAME_MAX = 32;
const DOC_MAX = 100;
/** A name: small letters and digits, with a hyphen between the parts. */
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** The characters that a doc line must not have: the end of a comment, and the characters that the host refuses. */
const DOC_BAD = /\*\/|[;|&$`<>\\"\r\n]/;

/** The name that a saved camera cannot have: the framing of the room kit has no view to replace. */
export const FIXED_CAMERA = "overview";

/** Why a name is not a name of a new camera, or null. */
export function cameraNameProblem(name: string): string | null {
  if (name.length === 0 || name.length > NAME_MAX) return t("lab-camera-name-length", { max: String(NAME_MAX) });
  if (!NAME.test(name)) return t("lab-camera-name-bad", { name });
  if (name === FIXED_CAMERA) return t("lab-camera-name-fixed", { name: FIXED_CAMERA });
  return null;
}

/** Why a text is not a doc line of a camera, or null. */
export function cameraDocProblem(doc: string): string | null {
  if (doc.trim().length === 0) return t("lab-camera-doc-empty");
  if (doc.length > DOC_MAX) return t("lab-camera-doc-length", { max: String(DOC_MAX) });
  if (DOC_BAD.test(doc)) return t("lab-camera-doc-bad");
  return null;
}

/** The doc line of a camera without a doc from the owner. */
export function defaultCameraDoc(name: string): string {
  return `The view ${name}, saved in the lab (labs camera-save).`;
}

/** The view of a `--view` value: the text of the `view` URL parameter, or a lab URL with it. Null for no view. */
export function viewOfArg(text: string): NamedView | null {
  if (!text.includes("?")) return parseView(text.replace(/^view=/, ""));
  try {
    return parseView(new URL(text, "http://lab").searchParams.get("view"));
  } catch {
    return null;
  }
}

/** The options of a save of a camera. */
export interface CameraSaveArgs {
  readonly name: string;
  readonly view: NamedView;
  readonly doc?: string;
  readonly replace?: boolean;
  readonly dry?: boolean;
}

/** The command line of a save for a terminal in the repository root (a lab page without the workbench). */
export function cameraSaveCommand(args: CameraSaveArgs): string {
  const doc = args.doc === undefined ? "" : ` --doc "${args.doc}"`;
  const flags = `${args.replace === true ? " --replace" : ""}${args.dry === false ? "" : " --dry"}`;
  return `bun run labs camera-save ${args.name} --view=${viewText(args.view)}${doc}${flags}`;
}
