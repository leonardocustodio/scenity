// SPDX-License-Identifier: Apache-2.0
/**
 * The entry point `@scenity/assets/release`: the approval records, the generic release gate and the release
 * gate of a project folder. The project document gives the rules (`release`).
 */
export * from "./approval";
export * from "./gate";
export * from "./project";
// The project document of @scenity/scene holds the schema of the rules.
export { approvalRuleSchema, releaseSchema, type ApprovalRule, type ReleaseConfig } from "@scenity/scene";
