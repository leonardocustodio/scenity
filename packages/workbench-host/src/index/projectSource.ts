// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index source of a scene project: the content config of the project
 * (`projectContent`) and the plans of its scenes and sequences (`projectPlans` of `@scenity/labs-platform`). The plans
 * read the documents from the disk at each call, so an edit of a sequence (a new marker, a new duration) gives new
 * plans with the next content hash.
 */
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { ContentConfig } from "@scenity/labs-platform/contentHash";
import type { FrameIndexSource } from "@scenity/labs-platform/indexSource";
import { PROJECT_DOCUMENT, projectPlans, type ProjectIndexDocument } from "@scenity/labs-platform/projectIndex";
import { isDenied } from "../denylist";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The JSON of a file of the project folder, or null (a path out of the folder, a denied path, no file, bad JSON). */
export function readProjectJson(dir: string, path: string): unknown {
  const full = resolve(dir, path);
  const near = relative(dir, full);
  if (near === "" || near.startsWith("..") || isDenied(near.split(sep).join("/"))) return null;
  try {
    return JSON.parse(readFileSync(full, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** The project document and its scene and sequence documents, read from the disk at each call. */
export function readProjectDocuments(dir: string): {
  readonly project: ProjectIndexDocument;
  readonly files: Readonly<Record<string, unknown>>;
} {
  const project = record(readProjectJson(dir, PROJECT_DOCUMENT)) ?? {};
  const paths = [...strings(project.scenes), ...strings(project.sequences)];
  const files: Record<string, unknown> = {};
  for (const path of paths) files[path] = readProjectJson(dir, path);
  return { project, files };
}

/** The source of the project in `dir` with its content config. */
export function projectIndexSource(dir: string, content: ContentConfig): FrameIndexSource {
  const folder = resolve(dir);
  return {
    content,
    plans: () => {
      const { project, files } = readProjectDocuments(folder);
      return projectPlans(project, files);
    },
  };
}
