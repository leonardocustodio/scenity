// SPDX-License-Identifier: Apache-2.0
/**
 * The content hash of the frames: a hash of the working-tree files that a frame depends on and of the asset manifest.
 * The Vite plugin of the lab (`labsContentHash`) and the host calculate it with this module from the files on the
 * disk, never from the commit or the clock. Thus an edit that is not committed changes the hash, and a restart of a
 * server keeps it.
 *
 * The module is pure. A caller gives the file functions of `node:fs` (`fsContentReader`), so the same code runs in
 * Vite (Node or Bun) and in the host (Bun).
 */
import {
  familyParts,
  familyRegistry,
  scanSource,
  type ContentSnapshot,
  type FamilyConfig,
  type FileScan,
} from "./contentParts";
import { sha256Hex } from "./sha256";

/**
 * Paths that a frame never depends on in any project: hidden files and keys (the denylist of the workbench host). A
 * content config of a plugin adds its own paths to this list.
 */
export const ALWAYS_EXCLUDED: readonly RegExp[] = [
  /(^|\/)\./,
  /(^|\/)(node_modules|dist|test-results)\//,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)/i,
];

/**
 * The inputs of a content hash: the roots, the asset manifest, the paths to leave out and the pose families. A
 * project gives them (`projectContent`), or a plugin gives them through its frame index source (indexSource.ts). An
 * edit of any file under a root makes the index of every take stale. The exception is an edit of a family part that
 * the frame does not read (contentParts.ts).
 */
export interface ContentConfig {
  /** Folders relative to the root of the hash, with `/` and no final `/`. */
  readonly roots: readonly string[];
  /** The asset manifest, or null when the project has none. Its SHA-256 stands for every asset file that it lists. */
  readonly manifest: string | null;
  readonly excluded: readonly RegExp[];
  /** The pose families of the family parts, or null (absent) for none: each file is shared. */
  readonly families?: FamilyConfig | null;
}

/** The parts of a project document (`scenity.project/1`, @scenity/scene) that give its content roots. */
export interface ProjectContent {
  readonly scenes?: readonly string[] | undefined;
  readonly sequences?: readonly string[] | undefined;
  readonly assets?: readonly string[] | undefined;
  readonly plugins?: readonly string[] | undefined;
  /** The paths of the rules documents, and inline rules (they are in the project file). */
  readonly rules?: readonly (string | { readonly id: string })[] | undefined;
  readonly workbench?: { readonly contentRoots?: readonly string[] | undefined } | undefined;
}

/** The paths of the rules documents of a project; an inline rule has no file of its own. */
function rulePaths(rules: ProjectContent["rules"]): string[] {
  return (rules ?? []).filter((item): item is string => typeof item === "string");
}

/** The folder of a document path; a path whose last part has no dot is a folder already (a plugin folder). */
function folderOf(path: string): string {
  const clean = path.replace(/^\.\//, "").replace(/\/$/, "");
  const slash = clean.lastIndexOf("/");
  if (!clean.slice(slash + 1).includes(".")) return clean;
  return slash < 0 ? "" : clean.slice(0, slash);
}

function under(base: string, path: string): string {
  const clean = path.replace(/^\.\//, "").replace(/\/$/, "");
  return base === "" ? clean : clean === "" ? base : `${base}/${clean}`;
}

/**
 * The content config of a project. `base` is the folder of the project relative to the root of the hash.
 * The roots are `workbench.contentRoots` when the project gives them; else the folders of the scenes, sequences,
 * rules and plugins, and the asset roots. A document at the project root makes the project folder a root.
 */
export function projectContent(project: ProjectContent, base = ""): ContentConfig {
  const explicit = project.workbench?.contentRoots;
  const parts =
    explicit ??
    [project.scenes, project.sequences, rulePaths(project.rules), project.plugins, project.assets]
      .flatMap((list) => list ?? [])
      .map((path) => (project.assets?.includes(path) === true ? path.replace(/\/$/, "") : folderOf(path)));
  const roots = [...new Set(parts.map((part) => under(base, part)))].sort();
  // A root inside another root adds nothing.
  const outer = roots.filter(
    (root) => !roots.some((other) => other !== root && (other === "" || root.startsWith(`${other}/`))),
  );
  return { roots: outer, manifest: null, excluded: ALWAYS_EXCLUDED };
}

/** True when a path (relative to the root of the hash, with `/`) is an input of the content hash of `config`. */
export function isContentFileIn(config: ContentConfig, path: string): boolean {
  if (path === config.manifest) return true;
  if (!config.roots.some((root) => root === "" || path.startsWith(`${root}/`))) return false;
  return !config.excluded.some((pattern) => pattern.test(path));
}

/** One input file of the hash: its path relative to the repo root and the SHA-256 of its bytes. */
export interface ContentEntry {
  readonly path: string;
  readonly digest: string;
}

/** The content hash of the entries: 32 hex characters. The order of the entries does not change it. */
export function contentHashOf(entries: readonly ContentEntry[]): string {
  const lines = entries.map((entry) => `${entry.path}\t${entry.digest}\n`).sort();
  return sha256Hex(`labs-content/1\n${lines.join("")}`).slice(0, 32);
}

/** The file functions that the hash reads: the paths of the content files, and the bytes of one file. */
export interface ContentReader {
  /** Every content file, relative to the repo root, with `/`. */
  files(): string[];
  /** The bytes of a file, or null when it is gone. */
  read(path: string): Uint8Array | null;
  /** A stamp of a file (its size and modification time) for the digest cache, or null when it is gone. */
  stamp?(path: string): string | null;
  /** The pose families of the family parts, or null (absent) for none. */
  readonly families?: FamilyConfig | null;
}

/** The parts of `node:fs` that `fsContentReader` uses. */
export interface FsLike {
  readdirSync(path: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(path: string): Uint8Array;
  statSync(path: string): { size: number; mtimeMs: number };
  existsSync(path: string): boolean;
}

/** A reader of the content files of `config` under `webRoot` (the root of the hash) with the functions of `node:fs`. */
export function fsContentReader(fs: FsLike, webRoot: string, config: ContentConfig): ContentReader {
  const full = (path: string): string => (path === "" ? webRoot : `${webRoot.replace(/\/$/, "")}/${path}`);
  const walk = (dir: string, out: string[]): void => {
    if (!fs.existsSync(full(dir))) return;
    for (const entry of fs.readdirSync(full(dir), { withFileTypes: true })) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (isContentFileIn(config, `${path}/x`)) walk(path, out);
      } else if (isContentFileIn(config, path)) out.push(path);
    }
  };
  return {
    families: config.families ?? null,
    files() {
      const out: string[] = [];
      for (const root of config.roots) walk(root, out);
      // The manifest can be outside the roots (the built assets of a plugin): the list adds it.
      const manifest = config.manifest;
      if (manifest !== null && !out.includes(manifest) && fs.existsSync(full(manifest))) out.push(manifest);
      return out;
    },
    read(path) {
      try {
        return fs.readFileSync(full(path));
      } catch {
        return null;
      }
    },
    stamp(path) {
      try {
        const stat = fs.statSync(full(path));
        return `${String(stat.size)}:${String(stat.mtimeMs)}`;
      } catch {
        return null;
      }
    },
  };
}

/** True for a file that the scan of contentParts.ts reads (TypeScript and Vue). */
function isSource(path: string): boolean {
  return /\.(ts|vue)$/.test(path);
}

/** The scan of a file, or null for a file that is not source. */
function scanOf(path: string, bytes: Uint8Array, families: FamilyConfig | null): FileScan | null {
  return isSource(path) ? scanSource(new TextDecoder().decode(bytes), families?.registryName ?? null) : null;
}

/**
 * The content hash with a cache of the file digests. A file whose stamp did not change keeps its digest. Thus a new
 * hash after an edit reads only the changed files. Use one instance per server.
 */
export class ContentHasher {
  readonly #reader: ContentReader;
  readonly #digest: (bytes: Uint8Array) => string;
  readonly #cache = new Map<string, { stamp: string; digest: string }>();

  /** `digest` defaults to `sha256Hex`; a caller may give the SHA-256 of `node:crypto` (the same value, faster). */
  constructor(reader: ContentReader, digest: (bytes: Uint8Array) => string = sha256Hex) {
    this.#reader = reader;
    this.#digest = digest;
  }

  #entry(path: string): ContentEntry | null {
    const stamp = this.#reader.stamp?.(path) ?? null;
    const kept = this.#cache.get(path);
    if (stamp !== null && kept?.stamp === stamp) return { path, digest: kept.digest };
    const bytes = this.#reader.read(path);
    if (bytes === null) {
      this.#cache.delete(path);
      return null;
    }
    const digest = this.#digest(bytes);
    if (stamp !== null) this.#cache.set(path, { stamp, digest });
    // Scan a new source file here, so that a snapshot does not read it again.
    if (!this.#scans.has(digest)) this.#scans.set(digest, scanOf(path, bytes, this.#families));
    return { path, digest };
  }

  #entries(): ContentEntry[] {
    const entries: ContentEntry[] = [];
    for (const path of this.#reader.files()) {
      const entry = this.#entry(path);
      if (entry !== null) entries.push(entry);
    }
    return entries;
  }

  /** The content hash of the current files. */
  hash(): string {
    return contentHashOf(this.#entries());
  }

  /** The scans of the source files by digest (the files of the last snapshot). */
  #scans = new Map<string, FileScan | null>();
  /** The pose families of the reader, or null. */
  get #families(): FamilyConfig | null {
    return this.#reader.families ?? null;
  }

  /** The text of the family registry by digest. */
  #registry: { digest: string; text: string | null } | null = null;

  /**
   * The content hash with the digest of each file and the family parts (contentParts.ts). The scan of a file reads it
   * again only when its digest is new.
   */
  snapshot(): ContentSnapshot {
    const entries = this.#entries();
    const scans = new Map<string, FileScan | null>();
    const decoder = new TextDecoder();
    const files = entries.map((entry) => {
      let scan = this.#scans.get(entry.digest) ?? scans.get(entry.digest);
      if (scan === undefined) {
        const bytes = isSource(entry.path) ? this.#reader.read(entry.path) : null;
        scan = bytes === null ? null : scanOf(entry.path, bytes, this.#families);
      }
      scans.set(entry.digest, scan);
      return { path: entry.path, scan };
    });
    this.#scans = scans;
    const families = this.#families;
    const registry = families === null ? undefined : entries.find((entry) => entry.path === familyRegistry(families));
    if (registry === undefined) this.#registry = null;
    else if (this.#registry?.digest !== registry.digest) {
      const bytes = this.#reader.read(registry.path);
      this.#registry = { digest: registry.digest, text: bytes === null ? null : decoder.decode(bytes) };
    }
    return {
      hash: contentHashOf(entries),
      digests: new Map(entries.map((entry) => [entry.path, entry.digest])),
      parts: familyParts(files, this.#registry?.text ?? null, families),
    };
  }
}
