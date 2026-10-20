// SPDX-License-Identifier: Apache-2.0
/**
 * The batches of the output of a run. A `labs` run writes many small chunks to stdout. One `runs.output` event (one
 * WebSocket message per page) for each chunk is too many. The batch joins the chunks of one stream for at most
 * OUTPUT_BATCH_MS and sends them as one event. The order of the text stays: a chunk of the other stream sends the
 * batch first, and the end of the run sends the last batch before `runs.done`.
 */

/** The longest time that a chunk of output waits in a batch (ms): one frame of the page. */
export const OUTPUT_BATCH_MS = 16;

export type RunStream = "stdout" | "stderr";

export class OutputBatch {
  readonly #send: (stream: RunStream, data: string) => void;
  readonly #waitMs: number;
  #stream: RunStream | null = null;
  #parts: string[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(send: (stream: RunStream, data: string) => void, waitMs = OUTPUT_BATCH_MS) {
    this.#send = send;
    this.#waitMs = waitMs;
  }

  /** Add a chunk. A chunk of the other stream sends the batch first. */
  push(stream: RunStream, data: string): void {
    if (data === "") return;
    if (this.#stream !== null && this.#stream !== stream) this.flush();
    this.#stream = stream;
    this.#parts.push(data);
    if (this.#waitMs <= 0) {
      this.flush();
      return;
    }
    this.#timer ??= setTimeout(() => {
      this.#timer = null;
      this.flush();
    }, this.#waitMs);
  }

  /** Send the batch immediately (the end of the run). */
  flush(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    const stream = this.#stream;
    const data = this.#parts.join("");
    this.#stream = null;
    this.#parts = [];
    if (stream !== null && data !== "") this.#send(stream, data);
  }
}
