// SPDX-License-Identifier: Apache-2.0
/**
 * The default sequence of a form of the dock. The host gives it with the project (`host.hello`), from a host plugin or
 * from the first sequence of the project. The form field takes it while the field is empty. Thus a later answer of the
 * host fills the field, and a value of the owner stays.
 */
import { watch, type Ref } from "vue";

export function useDefaultSequence(field: Ref<string>, source: () => string | null | undefined): void {
  watch(
    source,
    (name) => {
      if (field.value === "" && name !== null && name !== undefined) field.value = name;
    },
    { immediate: true },
  );
}
