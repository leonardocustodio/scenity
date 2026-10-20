// SPDX-License-Identifier: Apache-2.0
/**
 * A small ZIP writer for `scenity publish`: the files of a folder, each deflated (`node:zlib`), with the CRC-32 of each
 * file. The archive has a fixed date (1980-01-01) and the files in sorted order, so the same folder gives the same
 * bytes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

/** One file of an archive: its path in the archive (with `/`) and its bytes. */
export interface ZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** The files of a folder as archive entries, in sorted order. */
export function folderEntries(dir: string): ZipEntry[] {
  const out: ZipEntry[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push({ path: relative(dir, path).split(sep).join("/"), bytes: new Uint8Array(readFileSync(path)) });
    }
  };
  walk(dir);
  return out;
}

/** The DOS date of 1980-01-01 and the time 00:00 (the fixed date of each entry). */
const DOS_DATE = (1 << 5) | 1;

/** The bytes of a ZIP archive of the entries. */
export function zipBytes(entries: readonly ZipEntry[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const data = deflateRawSync(entry.bytes);
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(entry.bytes.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt16LE(0, 12);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.byteLength, 20);
    head.writeUInt32LE(entry.bytes.byteLength, 24);
    head.writeUInt16LE(name.byteLength, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += local.byteLength + name.byteLength + data.byteLength;
  }
  const size = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}
