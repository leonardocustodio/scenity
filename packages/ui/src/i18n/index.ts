// SPDX-License-Identifier: Apache-2.0
/**
 * The Fluent resources of the ui package (namespace "ui"). The app gives them to createI18n() with its own
 * resources. The files are also exported as "@scenity/ui/i18n/en-US.ftl" and "…/pt-BR.ftl".
 */
import { collectResources, type FtlResource } from "@scenity/i18n";

const files = import.meta.glob<string>("./*.ftl", { query: "?raw", import: "default", eager: true });

/** The en-US and pt-BR resources of the ui components. */
export const UI_RESOURCES: readonly FtlResource[] = collectResources(
  Object.fromEntries(Object.entries(files).map(([path, source]) => [`packages/ui/src/i18n/${path.slice(2)}`, source])),
);
