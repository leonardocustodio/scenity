// SPDX-License-Identifier: Apache-2.0
/**
 * The agent loop in the page: the before and after of the last turn of Claude (`agent.turn`), the saved turns with
 * their sheets (useTurnHistory.ts), the notices (`agent.notify`) and the `Stop` gate (`agent.stopGate`,
 * `agent.setStopGate`).
 */
import type { EventPayload, StopGateState } from "@scenity/workbench-host/protocol";
import { getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type { HostClient } from "../host/hostClient";
import { createNotifier, type NoticeWindow, type Notifier } from "./notify";
import { useTurnHistory, type TurnHistory } from "./useTurnHistory";

/** The client parts of the loop. */
export type LoopClient = Pick<HostClient, "request" | "on" | "onHello">;

/** The last turn with a before and an after picture. */
export type TurnView = EventPayload<"agent.turn">;

export interface AgentLoopView {
  /** The last `agent.turn` event. */
  readonly turn: Readonly<ShallowRef<TurnView | null>>;
  /** The saved turns and the turn in the panel. */
  readonly history: TurnHistory;
  readonly gate: Readonly<Ref<StopGateState>>;
  /** The error of the last gate request, or null. */
  readonly gateError: Readonly<Ref<string | null>>;
  setGate(on: boolean): Promise<void>;
}

const GATE_OFF: StopGateState = { on: false, take: null, last: null };

/** Follow the loop events of the host client (a ref: the client changes when the host comes back). */
export function useAgentLoop(
  client: Readonly<Ref<LoopClient | null>>,
  win: NoticeWindow | null = globalThis,
): AgentLoopView {
  const turn = shallowRef<TurnView | null>(null);
  const history = useTurnHistory(turn);
  const gate = ref<StopGateState>(GATE_OFF);
  const gateError = ref<string | null>(null);
  const notifier: Notifier | null = win === null ? null : createNotifier(win);
  let stops: (() => void)[] = [];
  const stopWatch = watch(
    client,
    (current) => {
      for (const stop of stops) stop();
      stops = [];
      if (current === null) return;
      stops = [
        current.on("agent.turn", (payload) => (turn.value = payload)),
        current.on("agent.stopGate", (payload) => (gate.value = payload.gate)),
        current.on("agent.notify", (payload) => void notifier?.show(payload.title, payload.message)),
        ...history.listen(current),
      ];
      // Read the state of the gate and the saved turns now and after each new connection.
      // A request fails before a connection.
      const refresh = (): void => {
        current.request("agent.setStopGate", {}).then(
          (state) => (gate.value = state),
          () => undefined,
        );
        void history.load(current);
      };
      stops.push(current.onHello(refresh));
      refresh();
    },
    { immediate: true },
  );
  async function setGate(on: boolean): Promise<void> {
    const current = client.value;
    if (current === null) return;
    gateError.value = null;
    try {
      gate.value = await current.request("agent.setStopGate", { on });
    } catch (error) {
      gateError.value = error instanceof Error ? error.message : String(error);
    }
  }
  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      stopWatch();
      for (const stop of stops) stop();
      notifier?.dispose();
    });
  }
  return { turn, history, gate, gateError, setGate };
}
