// SPDX-License-Identifier: Apache-2.0
/**
 * The host in Vue refs: the endpoint search, the state of the connection, the open
 * checkout and its surfaces. A `surface.state` event of the host replaces the state of that surface.
 */
import type {
  Checkout,
  HelloAccess,
  HostEndpoint,
  RequestParams,
  RequestResult,
  RequestType,
  SurfaceState,
} from "@scenity/workbench-host/protocol";
import { getCurrentScope, onScopeDispose, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { findEndpoint, type EndpointSource, type EndpointWindow } from "./endpoint";
import { HostClient, type Hello, type HostStatus } from "./hostClient";

/** The state of the host for the page: the endpoint search, no endpoint, or the state of the connection. */
export type HostState = "looking" | "none" | HostStatus;

/** A request to the host. */
export type HostRequest = <T extends RequestType>(type: T, params: RequestParams<T>) => Promise<RequestResult<T>>;

export interface HostApi {
  readonly state: Readonly<Ref<HostState>>;
  readonly endpoint: Readonly<ShallowRef<HostEndpoint | null>>;
  readonly source: Readonly<Ref<EndpointSource | null>>;
  readonly client: Readonly<ShallowRef<HostClient | null>>;
  /** True after the first `host.hello` answer. */
  readonly greeted: Readonly<Ref<boolean>>;
  /**
   * The project, the Git state and the role of the page from `host.hello`. The value is null before the first
   * answer, for an old host, or for a fake host of a test.
   */
  readonly access?: Readonly<ShallowRef<HelloAccess | null>>;
  /** The origin of the workbench page; the frames answer only to it. */
  readonly pageOrigin: string;
  readonly checkout: Ref<Checkout | null>;
  readonly surfaces: Ref<readonly SurfaceState[]>;
  readonly request: HostRequest;
  /** Open a checkout: the host starts its dev servers (a failed server starts again). */
  openCheckout(path: string): Promise<void>;
}

export interface UseHostOptions {
  readonly win?: EndpointWindow & { readonly location: { readonly origin: string } };
  readonly find?: () => Promise<{ endpoint: HostEndpoint; source: EndpointSource } | null>;
  readonly makeClient?: (endpoint: HostEndpoint, pageOrigin: string) => HostClient;
}

/** Put a new surface state in the list: the same ID replaces the old state. */
export function upsertSurface(list: readonly SurfaceState[], next: SurfaceState): SurfaceState[] {
  const index = list.findIndex((surface) => surface.id === next.id);
  if (index === -1) return [...list, next];
  return list.map((surface, at) => (at === index ? next : surface));
}

/** The access part of a `host.hello` result, or null for an old host (no project in the answer). */
export function accessOf(hello: Hello): HelloAccess | null {
  const { project, git, role, auth, remote } = hello;
  if (project === undefined || role === undefined) return null;
  return { project, git: git !== false, role, auth: auth ?? "none", remote: remote === true };
}

export function useHost(options: UseHostOptions = {}): HostApi {
  const win = options.win ?? globalThis;
  const pageOrigin = win.location.origin;
  const state = ref<HostState>("looking");
  const endpoint = shallowRef<HostEndpoint | null>(null);
  const source = ref<EndpointSource | null>(null);
  const client = shallowRef<HostClient | null>(null);
  const checkout = ref<Checkout | null>(null);
  const surfaces = ref<readonly SurfaceState[]>([]);
  const greeted = ref(false);
  const access = shallowRef<HelloAccess | null>(null);
  let disposed = false;

  function onHello(hello: Hello): void {
    checkout.value = hello.checkout;
    surfaces.value = hello.surfaces;
    access.value = accessOf(hello);
    greeted.value = true;
  }

  function start(found: { endpoint: HostEndpoint; source: EndpointSource }): void {
    endpoint.value = found.endpoint;
    source.value = found.source;
    const made =
      options.makeClient?.(found.endpoint, pageOrigin) ?? new HostClient({ endpoint: found.endpoint, pageOrigin });
    made.onStatus((status) => (state.value = status));
    made.onHello(onHello);
    made.on("surface.state", ({ surface }) => {
      if (checkout.value !== null && surface.checkout !== checkout.value.path) return;
      surfaces.value = upsertSurface(surfaces.value, surface);
    });
    client.value = made;
    state.value = made.status;
    made.connect();
  }

  void (options.find ?? (() => findEndpoint(win)))().then(
    (found) => {
      if (disposed) return;
      if (found === null) state.value = "none";
      else start(found);
    },
    () => {
      if (!disposed) state.value = "none";
    },
  );

  const request: HostRequest = (type, params) => {
    const current = client.value;
    return current === null ? Promise.reject(new Error("The host is not connected.")) : current.request(type, params);
  };

  async function openCheckout(path: string): Promise<void> {
    const opened = await request("checkouts.open", { path });
    checkout.value = opened.checkout;
    surfaces.value = opened.surfaces;
  }

  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      disposed = true;
      client.value?.close();
    });
  }
  return { state, endpoint, source, client, greeted, access, pageOrigin, checkout, surfaces, request, openCheckout };
}
