// SPDX-License-Identifier: Apache-2.0
/** One option of a select, a combobox or a menu. The label is already localized. */
export interface ListOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}
