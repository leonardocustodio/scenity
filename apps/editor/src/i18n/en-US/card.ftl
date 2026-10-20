# SPDX-License-Identifier: Apache-2.0

### The texts of the selection card over the scene of the lab page and of its picked block (src/core/edit).

## The header of the card (SelectionCard.vue).

card-selection = Selection
card-grip = Move the cards (arrow keys; Home puts them back)
card-grip-title = Drag to move the cards; a double click puts them back
card-unfold = Show the whole card
card-fold = Fold the card
card-fold-title = Fold the card to its header
card-clear = Clear the selection
card-clear-title = Clear the selection (Escape)
card-drag-move = move…
card-drag-turn = turn…
card-drag-lift = lift…

## The facts of the selected item. The values are data.

card-field-slot = slot
card-field-asset = asset
card-field-place = place
card-field-bone = bone
card-field-near = near
card-tune-keys = Tune keys
card-prop-keys = Drag: move (Shift 10 cm) · Shift+drag: turn · Alt+drag: lift · R: turn 15° (Alt 1°)
card-prop-propose = ⌘ with a drag: propose it (a ghost)

## Save placement and its layout gate.

card-gate =
    { $count ->
        [one] Save placement stops: { $count } layout check fails (provisional limits)
       *[other] Save placement stops: { $count } layout checks fail (provisional limits)
    }
card-override = Reason to save while a layout check fails
card-override-placeholder = Reason to save anyway (goes with the placement)…
card-undo = Undo
card-undo-title = Undo (⌘Z)
card-redo = Redo
card-redo-title = Redo (⇧⌘Z)
card-save-dry = Save placement (dry run)
card-save-apply = Apply to the runtime source
card-placement-dry = { $status } (dry run)

## The marks.

card-mark = Mark
card-mark-done = Done marking
card-marks-clear =
    { $count ->
        [one] Clear { $count } marks
       *[other] Clear { $count } marks
    }

## Ask Claude (SelectionCard.vue, useEditPanel.ts).

card-ask = Ask Claude about the selection
card-ask-placeholder-workbench = Ask Claude about this…
card-ask-placeholder = Ask Claude (copies the request)…
card-ask-send = Ask
card-ask-sent = Sent to the workbench…
card-ask-terminal = Sent to the Claude terminal with the picked block.
card-ask-chat = Sent to the chat with the picked block.
card-ask-no-session = No Claude session: open the Claude tab of the workbench, then ask again.
card-ask-clipboard = No workbench: the request and the picked block are on the clipboard.
card-ask-no-clipboard = No workbench and no clipboard: copy the picked block from the card.

## The picked block (pickedItem.ts): the card shows it, and the ask prompt carries it. The code puts two spaces in
## front of each line after the first line.

card-picked-block = Picked block
card-picked = Picked: { $kind } { $id }
card-picked-bone = Picked: { $kind } { $id }, bone { $bone }
card-picked-asset = asset: { $id } ({ $file })
card-picked-scratch = scratch prop of the import { $import } ({ $name }), a lab input only
card-picked-rights = source "{ $source }", licence "{ $licence }"
card-picked-rights-gap = source "{ $source }", licence "{ $licence }" (rights not allowed: { $gap })
card-picked-place = place: x { $x }, y { $y }, z { $z }, turn { $turn }°
card-picked-tunes = tune keys: { $keys }
card-picked-point = hit point: { $point }
card-picked-near = near: { $points }
card-picked-warning = warning: { $warning }
