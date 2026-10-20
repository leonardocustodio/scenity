// SPDX-License-Identifier: Apache-2.0
/**
 * The prompt queue of a session with a stream input. The host adds each prompt of the owner to the queue. The SDK
 * reads the queue as its `prompt` stream, so one `query()` takes many turns. `end()` ends the stream. Then the
 * session stops after its turn.
 */
import type { SDKUserMessage } from "./sdk";

export class PromptQueue implements AsyncIterable<SDKUserMessage> {
  readonly #items: SDKUserMessage[] = [];
  #wake: (() => void) | null = null;
  #ended = false;

  /** True after `end()`. */
  get ended(): boolean {
    return this.#ended;
  }

  /** Add one prompt of the owner. A prompt after `end()` is an error. */
  push(text: string): void {
    if (this.#ended) throw new Error("The session ended; resume it to send a prompt.");
    this.#items.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
    this.#wake?.();
  }

  /** End the input. */
  end(): void {
    this.#ended = true;
    this.#wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    for (;;) {
      const next = this.#items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.#ended) return;
      await new Promise<void>((resolve) => (this.#wake = resolve));
      this.#wake = null;
    }
  }
}
