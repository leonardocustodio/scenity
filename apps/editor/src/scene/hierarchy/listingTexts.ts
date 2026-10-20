// SPDX-License-Identifier: Apache-2.0
/**
 * The texts of a scene command listing in the language of the page. `@scenity/editor-core`
 * gives the title and the reason in English; the menus, the search box and the agents read the listing of the page.
 */
import type { CommandListing } from "@scenity/editor-core";
import { messageIdOf, t, textOr } from "../../texts";

/** The message IDs of the conditions of the core. */
const REASONS: Readonly<Record<string, string>> = {
  "No entity is solo.": "command-reason-no-solo",
  "The clipboard is empty.": "command-reason-clipboard-empty",
};

/** The selection rule in words of the core: "a entity selection (or the entity argument)". */
const RULE = /^(any|a (.+)) selection(?: \(or the (\w+) argument\))?$/;

function reasonOf(listing: CommandListing): string | null {
  const { reason } = listing;
  if (reason === null) return null;
  const known = REASONS[reason];
  if (known !== undefined) return t(known);
  const rule = RULE.exec(listing.selection);
  if (reason !== `${listing.id} needs ${listing.selection}.` || rule === null) return reason;
  const kinds =
    rule[1] === "any"
      ? t("command-kind-any")
      : (rule[2] ?? "")
          .split(" or ")
          .map((kind) => textOr(`command-kind-${kind}`, kind))
          .join(t("command-kind-or"));
  const arg = rule[3];
  return arg === undefined ? t("command-needs", { kinds }) : t("command-needs-or-arg", { kinds, arg });
}

/** A listing with its title and its reason in the language of the page. */
export function pageListing(listing: CommandListing): CommandListing {
  return {
    ...listing,
    title: textOr(messageIdOf("settings-command", listing.id), listing.title),
    reason: reasonOf(listing),
  };
}
