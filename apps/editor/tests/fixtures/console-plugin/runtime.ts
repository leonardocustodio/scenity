// SPDX-License-Identifier: Apache-2.0
/**
 * The runtime face of the test plugin of the Console panel: one component whose presenter
 * writes the same error to the console of the worker at each create and each update. The e2e test lists this folder
 * in the `plugins` field of a temporary copy of the showroom, and the Console shows the error once with its count.
 */
import { z } from "zod";
import { defineRuntimePlugin } from "@scenity/runtime/plugins";
import { defineComponent } from "@scenity/scene/components";

const alarm = defineComponent({
  id: "noisy.alarm",
  schema: z.strictObject({ level: z.number().optional() }),
  defaults: { level: 1 },
  editor: { label: "Alarm", group: "Fixture", fields: {} },
});

/** The error of the presenter: the same text each time. */
const ring = (): void => {
  console.error("noisy.alarm: the alarm of entity:armchair rings");
};

export default defineRuntimePlugin({
  id: "noisy",
  components: [alarm],
  presenters: {
    "noisy.alarm": {
      id: "noisy.alarm",
      create: () => {
        ring();
        return null;
      },
      update: () => {
        ring();
        return true;
      },
      dispose: () => undefined,
    },
  },
});
