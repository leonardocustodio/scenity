// SPDX-License-Identifier: Apache-2.0
/**
 * @fluent/syntax for the tools of the workspace (tools/check-i18n.ts).
 *
 * The workspace uses the isolated linker, so the root package sees only its own dependencies. This
 * package has @fluent/syntax as a development dependency, and the tools import it through this module.
 */
export * from "@fluent/syntax";
