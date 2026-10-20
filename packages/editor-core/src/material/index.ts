// SPDX-License-Identifier: Apache-2.0
/**
 * The material editor model: the fields and the texture slots of a material type from the schema, the edits of a
 * material document, the material channel of the one history and the assignment of a material asset to a part of an
 * entity (the command `material.assign`). The Vue panel of the editor app uses it.
 */
export * from "./fields";
export * from "./edits";
export * from "./channel";
export * from "./assign";
export * from "./commands";
