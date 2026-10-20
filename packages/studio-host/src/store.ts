// SPDX-License-Identifier: Apache-2.0
/**
 * The state folder of the studio and its JSON files. The folder is beside the state folders of the workbench hosts:
 * `<app>/studio` (on macOS `~/Library/Application Support/org.scenity.editor/studio`). Each file has a zod schema. A
 * missing file or a file that the studio cannot read gives the default value, so a bad file never stops the studio. A
 * write is atomic (a temp file and a rename), and a file with a secret gets the mode 600.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { z } from "zod";

/** The ID of the app folder of the user state (the workbench host shares it). */
export const APP_ID = "org.scenity.editor";

/** The default state folder of the studio for this machine and user. */
export function studioStateDir(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const base =
    platform === "darwin"
      ? join(home, "Library", "Application Support")
      : (env.XDG_STATE_HOME ?? join(home, ".local", "state"));
  return join(base, APP_ID, "studio");
}

/** Write `text` to `file` through a temp file and a rename. `secret` gives the mode 600. */
export function writeAtomic(file: string, text: string, secret = false): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, text, secret ? { mode: 0o600 } : undefined);
  if (secret) chmodSync(temp, 0o600);
  renameSync(temp, file);
}

/** One JSON file of the state folder with its schema and its default value. */
export class JsonFile<T> {
  constructor(
    readonly file: string,
    private readonly schema: z.ZodType<T>,
    private readonly fallback: () => T,
    private readonly secret = false,
  ) {}

  /** The value of the file, or the default when the file is missing or does not pass the schema. */
  read(): T {
    if (!existsSync(this.file)) return this.fallback();
    try {
      const parsed = this.schema.safeParse(JSON.parse(readFileSync(this.file, "utf8")));
      return parsed.success ? parsed.data : this.fallback();
    } catch {
      return this.fallback();
    }
  }

  /** Check `value` against the schema and write it. Throws for a value that does not pass. */
  write(value: T): T {
    const parsed = this.schema.parse(value);
    writeAtomic(this.file, `${JSON.stringify(parsed, null, 2)}\n`, this.secret);
    return parsed;
  }

  /** Read, change and write. */
  update(change: (value: T) => T): T {
    return this.write(change(this.read()));
  }
}
