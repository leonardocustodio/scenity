// SPDX-License-Identifier: Apache-2.0
/**
 * The zod parts that the document schemas and the component schemas share: IDs, vectors,
 * quaternions, colours and references.
 */
import { z } from "zod";

// The pages of Scenity have a strict CSP with Trusted Types. Without this setting, zod calls `Function("")` when it
// makes an object schema, and the page reports a CSP violation. Each schema module imports this module first.
z.config({ jitless: true });

/** The pattern of an entity ID, a scene ID, a prefab ID and a project ID. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** The pattern of a component ID: a built-in name, or a plugin ID, a dot and a name. */
export const COMPONENT_ID_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9-]*)*$/;
/** The pattern of a tag. */
export const TAG_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The pattern of an asset ID: letters, digits, `_`, `-` and `.`. */
export const ASSET_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
/** The pattern of a socket name or a bone name. */
export const SUB_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export const idSchema = z.string().regex(ID_PATTERN, "an ID has 1 to 64 letters, digits, '_' or '-'");
export const componentIdSchema = z.string().regex(COMPONENT_ID_PATTERN, "not a component ID");
export const tagSchema = z.string().regex(TAG_PATTERN, "a tag has 1 to 64 letters, digits, '_', '.', ':' or '-'");
export const tagsSchema = z.array(tagSchema);

export const vec2Schema = z.tuple([z.number(), z.number()]);
export const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
/** A unit quaternion `[x, y, z, w]`. The length must be 1 within 0.01 (the writer rounds the parts to 1e-6). */
export const quatSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine((q) => Math.abs(Math.hypot(...q) - 1) <= 0.01, "a rotation is a unit quaternion [x, y, z, w]");

/** A colour: `#rrggbb`, or `[r, g, b]` with each part in 0..255. */
export const colourSchema = z.union([
  z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb or [r, g, b]"),
  z.tuple([z.number().min(0).max(255), z.number().min(0).max(255), z.number().min(0).max(255)]),
]);

export const assetRefSchema = z
  .string()
  .regex(new RegExp(`^asset:${ASSET_ID_PATTERN.source.slice(1, -1)}$`), "an asset reference is asset:<id>");
export const entityRefSchema = z
  .string()
  .regex(
    new RegExp(`^entity:${ID_PATTERN.source.slice(1, -1)}(#${SUB_PATTERN.source.slice(1, -1)})?$`),
    "an entity reference is entity:<id> or entity:<id>#<socket or bone>",
  );
export const sceneRefSchema = z
  .string()
  .regex(new RegExp(`^scene:${ID_PATTERN.source.slice(1, -1)}$`), "a scene reference is scene:<id>");

/** A relative path in a project: no leading `/`, no `\`, no drive letter. */
export const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?![/\\])(?![A-Za-z]:)[^\\]*$/, "a path is relative to its document and uses '/'");

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Colour = z.infer<typeof colourSchema>;
