// SPDX-License-Identifier: Apache-2.0
/**
 * The project instructions of the agents: `AGENTS.md` of the project (the Instructions panel edits it), `CLAUDE.md`
 * (the panel shows it) and the skills folder `.scenity/skills/`. The skills folder has one Markdown file per skill:
 * its first heading is its name, and its first paragraph is its use. Each turn of a session gets the full instructions
 * (cut at `INSTRUCTIONS_MAX_CHARS`) and the list of the skills. The agent reads a skill file before it uses the skill.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The longest text of the instructions of a turn (characters). */
export const INSTRUCTIONS_MAX_CHARS = 20_000;

/** A skill of the project. */
export interface ProjectSkill {
  readonly file: string;
  readonly name: string;
  readonly use: string;
}

/** The instructions of a project. */
export interface ProjectInstructions {
  readonly agents: string | null;
  readonly claude: string | null;
  readonly skills: readonly ProjectSkill[];
}

function read(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** The skill of a Markdown file: the first heading and the first paragraph. */
export function skillOf(file: string, text: string): ProjectSkill {
  const lines = text.split("\n");
  const name =
    lines
      .find((line) => line.startsWith("# "))
      ?.slice(2)
      .trim() ?? file.replace(/\.md$/, "");
  const use =
    lines.find((line) => line.trim() !== "" && !line.startsWith("#") && !line.startsWith("---"))?.trim() ?? "";
  return { file: `.scenity/skills/${file}`, name, use };
}

/** Read the instructions and the skills of a project folder. */
export function readInstructions(dir: string): ProjectInstructions {
  const folder = join(dir, ".scenity", "skills");
  const skills = existsSync(folder)
    ? readdirSync(folder)
        .filter((file) => file.endsWith(".md"))
        .sort()
        .map((file) => skillOf(file, readFileSync(join(folder, file), "utf8")))
    : [];
  return { agents: read(join(dir, "AGENTS.md")), claude: read(join(dir, "CLAUDE.md")), skills };
}

/** Write `AGENTS.md` of a project. */
export function writeAgentsFile(dir: string, text: string): void {
  writeFileSync(join(dir, "AGENTS.md"), text);
}

/** The text of the instructions of a turn, or "" with none. */
export function instructionsText(instructions: ProjectInstructions): string {
  const parts: string[] = [];
  if (instructions.agents !== null) parts.push("## AGENTS.md", instructions.agents.trim());
  if (instructions.claude !== null) parts.push("## CLAUDE.md", instructions.claude.trim());
  if (instructions.skills.length > 0) {
    parts.push(
      "## Skills of the project (read the file of a skill before you use it)",
      ...instructions.skills.map((skill) => `- ${skill.name} (${skill.file}): ${skill.use}`),
    );
  }
  const text = parts.join("\n\n");
  return text.length <= INSTRUCTIONS_MAX_CHARS ? text : `${text.slice(0, INSTRUCTIONS_MAX_CHARS)}…`;
}
