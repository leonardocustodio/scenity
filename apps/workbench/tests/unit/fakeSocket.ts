// SPDX-License-Identifier: Apache-2.0
/**
 * A fake WebSocket and a fake host for the tests of the host client.
 */
import type { SocketLike } from "../../src/host/hostClient";

export class FakeSocket implements SocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: Record<string, unknown>[] = [];
  /** The binary frames (pictures), and the position of each frame among the JSON messages. */
  readonly binary: { readonly blob: Blob; readonly after: number }[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string | Blob): void {
    if (typeof data === "string") this.sent.push(JSON.parse(data) as Record<string, unknown>);
    else this.binary.push({ blob: data, after: this.sent.length });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({} as CloseEvent);
  }

  /** The host opens the connection. */
  open(): void {
    this.onopen?.({} as Event);
  }

  /** The host sends a message. */
  push(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  /** The last request of the given type. */
  last(type: string): Record<string, unknown> | undefined {
    return this.sent.findLast((message) => message.type === type);
  }
}

/** A socket factory that keeps every socket it makes. */
export function socketFactory(): { make: (url: string) => FakeSocket; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    make: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}
