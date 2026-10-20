// SPDX-License-Identifier: Apache-2.0
/**
 * The WebP re-encode of the saved pictures by the desktop shell.
 *
 * WebKit has no WebP encoder, so a picture of the labs app comes to the host as JPEG. When the shell started
 * the host with `SCENITY_WORKBENCH_SIGNALS=1` and `SCENITY_WORKBENCH_WEBP=1`, the picture store gives the path of
 * each new JPEG file to the shell as a signal line on stdout, `WORKBENCH_SIGNAL {"webp":"<path>"}` (the supervisor
 * gives the line to the shell, as the busy state of busy.ts). The shell encodes the WebP on a thread of its own,
 * writes `<id>.webp` and removes the JPEG. Then the store serves the WebP under the same ID (pictures.ts). Nothing
 * waits for it. A host without the shell (a browser) keeps the JPEG.
 */
import { SIGNAL_PREFIX, SIGNALS_ENV } from "./busy";
import { envValue } from "@scenity/labs-platform/envNames";

/** The environment switch of the shell: "1" when the shell re-encodes the JPEG pictures. */
export const WEBP_ENV = "SCENITY_WORKBENCH_WEBP";

/** The signal line of a JPEG file to re-encode. */
export function webpSignal(file: string): string {
  return `${SIGNAL_PREFIX}${JSON.stringify({ webp: file })}`;
}

/** The `onJpeg` of the picture store when the shell asks for it, else undefined (the JPEG stays). */
export function shellWebp(
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void = (line) => void process.stdout.write(line),
): ((file: string) => void) | undefined {
  if (envValue(SIGNALS_ENV, env) !== "1" || envValue(WEBP_ENV, env) !== "1") return undefined;
  return (file) => {
    write(`${webpSignal(file)}\n`);
  };
}
