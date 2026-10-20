// SPDX-License-Identifier: Apache-2.0
/**
 * A fake host for the component tests of the workbench page: refs that a test sets, and a request function that
 * answers from a table.
 */
import type { Checkout, HelloAccess, RequestType, SurfaceState } from "@scenity/workbench-host/protocol";
import { ref, shallowRef } from "vue";
import type { HostApi, HostRequest, HostState } from "../../src/host/useHost";

export const CHECKOUT: Checkout = {
  path: "/Users/leo/Development/Snowpine/scenity",
  branch: "lc/room3d-sdk",
  head: "4714a77d0000",
  changed: 3,
  open: true,
};

export function surfaceState(patch: Partial<SurfaceState> = {}): SurfaceState {
  return {
    id: "lab",
    kind: "scene",
    label: "Lab",
    capabilities: ["scene", "index"],
    checkout: CHECKOUT.path,
    url: "http://127.0.0.1:5400/?take=greet&t=6350",
    server: { status: "ready", port: 5400, error: null },
    lastEdit: null,
    ...patch,
  };
}

export type Answers = Partial<Record<RequestType, (params: unknown) => unknown>>;

export function fakeHost(
  options: {
    state?: HostState;
    greeted?: boolean;
    checkout?: Checkout | null;
    surfaces?: SurfaceState[];
    answers?: Answers;
    /** The project, the Git state and the role of `host.hello`. */
    access?: HelloAccess | null;
  } = {},
) {
  const calls: { type: RequestType; params: unknown }[] = [];
  const request = ((type: RequestType, params: unknown) => {
    calls.push({ type, params });
    const answer = options.answers?.[type];
    if (answer === undefined) return Promise.reject(new Error(`No answer for ${type}.`));
    try {
      return Promise.resolve(answer(params));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }) as HostRequest;
  const checkout = ref<Checkout | null>(options.checkout === undefined ? CHECKOUT : options.checkout);
  const surfaces = ref<readonly SurfaceState[]>(options.surfaces ?? [surfaceState()]);
  const host: HostApi = {
    state: ref<HostState>(options.state ?? "connected"),
    endpoint: shallowRef({ origin: "http://127.0.0.1:4100", token: "ab".repeat(32) }),
    source: ref("url"),
    client: shallowRef(null),
    greeted: ref(options.greeted ?? true),
    access: shallowRef(options.access ?? null),
    pageOrigin: "http://127.0.0.1:5300",
    checkout,
    surfaces,
    request,
    openCheckout: async (path: string) => {
      const opened = await request("checkouts.open", { path });
      checkout.value = opened.checkout;
      surfaces.value = opened.surfaces;
    },
  };
  return { host, calls, checkout, surfaces };
}
