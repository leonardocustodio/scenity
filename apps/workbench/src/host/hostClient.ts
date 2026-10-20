// SPDX-License-Identifier: Apache-2.0
/**
 * The WebSocket client of the host. It opens `/ws?token=` and sends `host.hello` with the page origin. It matches
 * each answer to its request by the `id` and gives each event to its listeners. After each failure, it connects again
 * with a longer wait.
 *
 * The host has no sign-in gate. `host.hello` gives the role of the token of the page and the Git state of the project
 * folder.
 *
 * The client has no framework. `useHost.ts` puts it in Vue refs.
 */
import {
  encodeIndexFrame,
  encodePictureHeader,
  HOST_PATHS,
  readHostMessage,
  type EventPayload,
  type EventType,
  type HostEndpoint,
  type RequestParams,
  type RequestResult,
  type RequestType,
} from "@scenity/workbench-host/protocol";
import { PictureCache, setPictureSource } from "./pictures";

/** The state of the connection: the first attempt, a working connection, or a lost one (the client tries again). */
export type HostStatus = "connecting" | "connected" | "lost";

/** The parts of a WebSocket that the client uses (a test gives a fake). */
export interface SocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  /** A JSON text, or the binary frame of a picture. */
  send(data: string | Blob): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** The result of `host.hello`. */
export type Hello = RequestResult<"host.hello">;

export interface HostClientOptions {
  readonly endpoint: HostEndpoint;
  /** The origin of the workbench page (`location.origin`). */
  readonly pageOrigin: string;
  readonly socket?: SocketFactory;
  /** The time limit of a request (ms). */
  readonly timeoutMs?: number;
  /** The first wait before a new attempt and the longest wait (ms). Each failure doubles the wait. */
  readonly backoff?: { readonly firstMs: number; readonly maxMs: number };
}

/** The default time limit of a request (ms). A capture of the lab can take some seconds. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** The default waits before a new attempt (ms). */
export const BACKOFF = { firstMs: 250, maxMs: 8_000 } as const;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

type Listener = (payload: never) => void;

/** The URL of the WebSocket of the host. */
export function socketUrl(endpoint: HostEndpoint): string {
  return `${endpoint.origin.replace(/^http/, "ws")}${HOST_PATHS.ws}?token=${encodeURIComponent(endpoint.token)}`;
}

/** The wait before the attempt after `failures` failures (ms). */
export function backoffMs(failures: number, backoff: HostClientOptions["backoff"] = BACKOFF): number {
  return Math.min(backoff.maxMs, backoff.firstMs * 2 ** Math.max(0, failures - 1));
}

export class HostClient {
  #status: HostStatus = "connecting";
  #hello: Hello | null = null;
  #socket: SocketLike | null = null;
  #nextId = 1;
  #failures = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #closed = false;
  /** The socket is open (the pictures go only on an open socket). */
  #open = false;
  readonly #pending = new Map<number, Pending>();
  readonly #events = new Map<string, Set<Listener>>();
  readonly #statusListeners = new Set<(status: HostStatus) => void>();
  readonly #helloListeners = new Set<(hello: Hello) => void>();

  readonly options: HostClientOptions;
  /** The pictures of the host by ID, as object URLs (`GET /pictures/<id>`). */
  readonly pictures: PictureCache;

  constructor(options: HostClientOptions) {
    this.options = options;
    this.pictures = new PictureCache({ endpoint: options.endpoint });
    setPictureSource(this.pictures);
  }

  /**
   * Send the picture bytes of a surface request as one binary frame (the header of the protocol, then the
   * bytes). The `surface.call` of the request follows on the same socket, so the host joins the two. The Blob joins
   * the header and the bytes without a copy in the page.
   */
  sendPicture(request: number, mime: string, bytes: ArrayBuffer): void {
    const socket = this.#socket;
    if (socket === null || !this.#open) throw new Error("The host is not connected.");
    socket.send(new Blob([encodePictureHeader(request, mime), bytes]));
  }

  /**
   * Send the picture of an index job as one binary frame (`WBI\x01`, `encodeIndexFrame`). The `index.done` of
   * the job follows on the same socket, so the host joins the two.
   */
  sendIndexFrame(job: number, mime: string, bytes: ArrayBuffer): void {
    const socket = this.#socket;
    if (socket === null || !this.#open) throw new Error("The host is not connected.");
    socket.send(new Blob([encodeIndexFrame(job, mime, new Uint8Array(bytes))]));
  }

  get status(): HostStatus {
    return this.#status;
  }

  /** The last `host.hello` result, or null before the first connection. */
  get hello(): Hello | null {
    return this.#hello;
  }

  /** Open the connection. The client connects again by itself until `close()`. */
  connect(): void {
    if (this.#closed || this.#socket !== null) return;
    const make = this.options.socket ?? ((url: string) => new WebSocket(url));
    let socket: SocketLike;
    try {
      socket = make(socketUrl(this.options.endpoint));
    } catch {
      this.#lost();
      return;
    }
    this.#socket = socket;
    socket.onopen = () => {
      this.#open = true;
      void this.#greet(socket);
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") this.#receive(event.data);
    };
    socket.onclose = () => {
      if (this.#socket === socket) this.#drop();
    };
    socket.onerror = () => undefined;
  }

  /**
   * Send a request and give its result. It fails when the host answers with an error, when the time ends or when
   * the connection closes.
   */
  request<T extends RequestType>(type: T, params: RequestParams<T>, timeoutMs?: number): Promise<RequestResult<T>> {
    if (this.#status !== "connected") return Promise.reject(new Error("The host is not connected."));
    return this.#send(type, params, timeoutMs);
  }

  /** Listen for an event of the host. Returns the function that stops the listener. */
  on<T extends EventType>(type: T, listener: (payload: EventPayload<T>) => void): () => void {
    const set = this.#events.get(type) ?? new Set<Listener>();
    this.#events.set(type, set);
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Listen for a change of the status. */
  onStatus(listener: (status: HostStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /** Listen for each `host.hello` result (the first connection and each new one). */
  onHello(listener: (hello: Hello) => void): () => void {
    this.#helloListeners.add(listener);
    return () => this.#helloListeners.delete(listener);
  }

  /** Close the connection for good: no new attempt. */
  close(): void {
    this.#closed = true;
    if (this.#retry !== null) clearTimeout(this.#retry);
    const socket = this.#socket;
    this.#socket = null;
    this.#open = false;
    this.#failAll("The host client closed.");
    this.pictures.clear();
    socket?.close(1000, "closed");
  }

  #send<T extends RequestType>(type: T, params: RequestParams<T>, timeoutMs?: number): Promise<RequestResult<T>> {
    const socket = this.#socket;
    if (socket === null) return Promise.reject(new Error("The host is not connected."));
    const id = this.#nextId++;
    return new Promise<RequestResult<T>>((resolve, reject) => {
      const limit = timeoutMs ?? this.options.timeoutMs ?? REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`The host did not answer ${type} in ${String(limit)} ms.`));
      }, limit);
      this.#pending.set(id, { resolve: resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ ...params, id, type }));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async #greet(socket: SocketLike): Promise<void> {
    try {
      const hello = await this.#send("host.hello", { origin: this.options.pageOrigin });
      if (this.#socket !== socket) return;
      this.#failures = 0;
      this.#hello = hello;
      this.#setStatus("connected");
      for (const listener of this.#helloListeners) listener(hello);
    } catch {
      if (this.#socket !== socket) return;
      socket.close(4000, "hello failed");
    }
  }

  #receive(text: string): void {
    const message = readHostMessage(text);
    if (message === null) return;
    if ("id" in message) {
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
      return;
    }
    const { type, ...payload } = message;
    for (const listener of this.#events.get(type) ?? []) (listener as (value: unknown) => void)(payload);
  }

  #drop(): void {
    this.#socket = null;
    this.#open = false;
    this.#failAll("The host connection closed.");
    this.#lost();
  }

  #lost(): void {
    if (this.#closed) return;
    this.#failures += 1;
    this.#setStatus("lost");
    this.#retry = setTimeout(
      () => {
        this.#retry = null;
        this.connect();
      },
      backoffMs(this.#failures, this.options.backoff),
    );
  }

  #failAll(reason: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.#pending.clear();
  }

  #setStatus(status: HostStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }
}
