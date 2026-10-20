// SPDX-License-Identifier: Apache-2.0
/**
 * The problems of the asset database in the Problems panel, with their fixes. A record with a missing source relinks to
 * a file of the project (the same file name first: a moved file). A reference of another document relinks to an asset
 * (by ID). A record with the ID of another record gets a new ID. The broken references of the open scene are the asset
 * problems of the page (`assetProblems`): Go to selects their entities.
 */
import { t } from "../../texts";
import type { DatabaseFix, DatabaseProblem } from "../../assetBrowser/assetTypes";
import type { Problem, ProblemFix } from "./problemList";

/** The most fixes of one problem. */
const FIXES = 3;

/** The fixes of a database problem. */
function fixesOf(problem: DatabaseProblem, fix: (input: DatabaseFix) => unknown): ProblemFix[] {
  const { code, id, file, pointer } = problem;
  if (code === "missing-source" && id !== null) {
    return problem.sources.slice(0, FIXES).map((source) => ({
      id: `relink:${source}`,
      label: t("problem-fix-relink-source", { path: source }),
      run: () => fix({ action: "source", id, source }),
    }));
  }
  if (code === "broken-reference" && pointer !== null) {
    return problem.assets.slice(0, FIXES).map((asset) => ({
      id: `relink:${asset.id}`,
      label: t("problem-fix-relink-asset", { name: asset.name, kind: asset.kind }),
      run: () => fix({ action: "reference", file, pointer, id: asset.id }),
    }));
  }
  if (code === "duplicate-id") {
    return [{ id: "new-id", label: t("problem-fix-new-id"), run: () => fix({ action: "new-id", file }) }];
  }
  return [];
}

/** The problems of the asset database except the broken references of the open scene (`scene`: its path). */
export function databaseProblems(
  problems: readonly DatabaseProblem[],
  scene: string,
  fix: (input: DatabaseFix) => unknown,
): Problem[] {
  return problems
    .filter((problem) => !(problem.code === "broken-reference" && problem.file === scene))
    .map((problem) => ({
      key: `database:${problem.code}:${problem.file}:${problem.pointer ?? ""}`,
      kind: "asset" as const,
      level: problem.code === "missing-file" ? ("warn" as const) : ("error" as const),
      title: t(`problem-db-${problem.code}`, { file: problem.file }),
      detail: problem.message,
      entities: [],
      time: null,
      file: problem.file,
      fixes: fixesOf(problem, fix),
    }));
}
