// SPDX-License-Identifier: Apache-2.0
/* eslint-disable vue/one-component-per-file -- The tests define small probe components. */
import { fireEvent, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import Button from "../src/primitives/Button.vue";
import Checkbox from "../src/primitives/Checkbox.vue";
import Dialog from "../src/primitives/Dialog.vue";
import NumberField from "../src/primitives/NumberField.vue";
import Select from "../src/primitives/Select.vue";
import Switch from "../src/primitives/Switch.vue";
import Tabs from "../src/primitives/Tabs.vue";
import Toaster from "../src/primitives/Toaster.vue";
import Toggle from "../src/primitives/Toggle.vue";
import { buttonVariants } from "../src/primitives/variants";
import { named, renderUi } from "./helpers";

describe("primitives", () => {
  it("Button is a native button of type button with token classes", () => {
    renderUi(Button, { props: { variant: "primary" }, slots: { default: "Start" } });
    const button = screen.getByRole("button", { name: "Start" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("bg-accent-brand");
    expect(button.className).toContain("pointer-coarse:min-h-target-touch");
  });

  it("button variants keep the minimum target size of 24 x 24 px", () => {
    expect(buttonVariants({ size: "sm" })).toContain("min-h-target-min");
    expect(buttonVariants({ size: "sm" })).toContain("min-w-target-min");
    expect(buttonVariants({ size: "lg" })).toContain("min-h-target-touch");
  });

  it("Toggle, Switch and Checkbox expose their state to assistive technology", async () => {
    renderUi(
      defineComponent({
        setup() {
          const on = ref(false);
          const checked = ref<boolean | "indeterminate">("indeterminate");
          return () =>
            h("div", [
              h(
                Toggle,
                { modelValue: on.value, "onUpdate:modelValue": (v: boolean) => (on.value = v) },
                () => "Freeze",
              ),
              h(Switch, { "aria-label": "Captions", modelValue: on.value }),
              h(Checkbox, { "aria-label": "Remember", modelValue: checked.value }),
            ]);
        },
      }),
    );
    const toggle = screen.getByRole("button", { name: "Freeze" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("switch", { name: "Captions" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: "Remember" }).getAttribute("aria-checked")).toBe("mixed");
  });

  it("Dialog has a title, a description and a named close button, and closes on it", async () => {
    const open = ref(true);
    renderUi(
      defineComponent({
        render: () =>
          h(
            Dialog,
            {
              open: open.value,
              "onUpdate:open": (v: boolean) => (open.value = v),
              title: "Order builder",
              description: "Build an order.",
            },
            { default: () => h("p", "body") },
          ),
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Order builder" });
    expect(dialog.textContent).toContain("Build an order.");
    await fireEvent.click(screen.getByRole("button", { name: named("Close") }));
    await waitFor(() => {
      expect(open.value).toBe(false);
    });
  });

  it("Select shows the placeholder from Fluent and takes a label", () => {
    renderUi(Select, {
      props: { options: [{ value: "a", label: "Overview" }], modelValue: "" },
      attrs: { "aria-label": "Recipient" },
    });
    const trigger = screen.getByRole("combobox", { name: "Recipient" });
    expect(trigger.textContent).toContain("Select…");
  });

  it("Tabs give a tab list with a name", () => {
    renderUi(Tabs, {
      props: {
        label: "Panels",
        modelValue: "a",
        tabs: [
          { value: "a", label: "Overview" },
          { value: "b", label: "Team" },
        ],
      },
      slots: { a: "Overview panel", b: "Team panel" },
    });
    expect(screen.getByRole("tablist", { name: "Panels" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  });

  it("NumberField has named decrement and increment buttons", () => {
    renderUi(NumberField, { props: { modelValue: 2, min: 0 }, attrs: { "aria-label": "Dose" } });
    expect(screen.getByRole("button", { name: named("Decrease") })).toBeTruthy();
    expect(screen.getByRole("button", { name: named("Increase") })).toBeTruthy();
  });

  it("Toaster names its region from Fluent, with the hotkey, in pt-BR", async () => {
    renderUi(Toaster, { props: { initial: [{ title: "Saved" }] }, locale: "pt-BR" });
    expect(await screen.findByRole("region", { name: named("Notificações (F8)") })).toBeTruthy();
  });
});
