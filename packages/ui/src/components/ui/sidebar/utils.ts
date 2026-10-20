// SPDX-License-Identifier: Apache-2.0
import type { ComputedRef, Ref } from "vue";
import { createContext } from "reka-ui";

export const SIDEBAR_WIDTH = "16rem";
export const SIDEBAR_WIDTH_MOBILE = "18rem";
export const SIDEBAR_WIDTH_ICON = "3rem";
export const SIDEBAR_KEYBOARD_SHORTCUT = "b";
/** From the md breakpoint of the token theme (56.25rem) the sidebar is a column. Below it, it is a sheet. */
export const SIDEBAR_DESKTOP_QUERY = "(min-width: 56.25rem)";

export const [useSidebar, provideSidebarContext] = createContext<{
  state: ComputedRef<"expanded" | "collapsed">;
  open: Ref<boolean>;
  setOpen: (value: boolean) => void;
  isMobile: Readonly<Ref<boolean>>;
  openMobile: Ref<boolean>;
  setOpenMobile: (value: boolean) => void;
  toggleSidebar: () => void;
}>("Sidebar");
