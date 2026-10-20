// SPDX-License-Identifier: Apache-2.0
/**
 * The sections of the Project settings window: the top fields of the project file in each section. A top field that no
 * section names goes into "Other". The Editor section holds the project values of the editor settings
 * (`scenity.editor.json`), not fields of the project file. Pure values, no DOM.
 */
import type { FormField, FormNode } from "./projectForm";

/** One section: its ID, the Fluent ID of its title and the top fields of the project file in it. */
export interface ProjectSection {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly string[];
}

export const PROJECT_SECTIONS: readonly ProjectSection[] = [
  { id: "general", title: "project-section-general", fields: ["format", "id", "name", "scenes", "sequences", "units"] },
  { id: "assets", title: "project-section-assets", fields: ["assets"] },
  { id: "plugins", title: "project-section-plugins", fields: ["plugins"] },
  { id: "rules", title: "project-section-rules", fields: ["rules"] },
  { id: "quality", title: "project-section-quality", fields: ["quality"] },
  { id: "build", title: "project-section-build", fields: ["build"] },
  { id: "release", title: "project-section-release", fields: ["release"] },
  { id: "workbench", title: "project-section-workbench", fields: ["workbench"] },
  { id: "editor", title: "project-section-editor", fields: [] },
];

const OTHER: ProjectSection = { id: "other", title: "project-section-other", fields: [] };

/** The sections with the root fields of each, and "Other" when a root field has no section. */
export function sectionsOf(root: FormNode): { section: ProjectSection; fields: FormField[] }[] {
  const all = root.kind === "object" ? root.fields : [];
  const named = new Set(PROJECT_SECTIONS.flatMap((section) => section.fields));
  const rest = all.filter((field) => !named.has(field.name));
  const sections = rest.length === 0 ? PROJECT_SECTIONS : [...PROJECT_SECTIONS, OTHER];
  return sections.map((section) => ({
    section,
    fields: section === OTHER ? rest : section.fields.flatMap((name) => all.filter((field) => field.name === name)),
  }));
}
