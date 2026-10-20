// SPDX-License-Identifier: Apache-2.0
/**
 * The default ID source: the system clock and the random bytes of `crypto`. Only the CLI and the tools use
 * this source. A pure function gets its source from the caller.
 */
import type { IdSource } from "./ids";

export const systemIdSource: IdSource = {
  now: () => Date.now(),
  random: (length) => crypto.getRandomValues(new Uint8Array(length)),
};
