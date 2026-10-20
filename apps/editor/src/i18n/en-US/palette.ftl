# SPDX-License-Identifier: Apache-2.0

### The words of the scene editor parts of the lab page: the command palette, the proposals card, "Save
### camera" and the Light section of the Tune tab.

## The command palette (CommandPalette.vue).

palette-dialog = Command palette
palette-command = Command
palette-query = Type a command…
palette-close = Close (Escape)
palette-close-label = Close the palette
palette-commands = Commands
palette-none = No command matches.
palette-arg-none = (none)
palette-run = Run
palette-back = Back

## The proposals card (ProposalCard.vue) and the op lines of a proposal (ghosts.ts).

palette-proposals = Proposals
palette-proposals-count = Proposals · { $count }
palette-proposals-hint = the ghosts show them
palette-operations = Operations
palette-by-owner = you
palette-by-claude = Claude
palette-by-script = script
palette-shown-ghost = ghost
palette-shown-marker = marker
palette-shown-card = card only
# $value holds the unit of the check; $limit is the limit text of the plugin.
palette-proposal-breaks = breaks { $id } { $value } · { $limit }
palette-proposal-mends = mends { $id }
# $summary is the summary of the layout checks of the plugin.
palette-proposal-no-change = layout checks: no change ({ $summary })
palette-proposal-accept = Accept
palette-proposal-accept-label = Accept { $id }
palette-proposal-reject = Reject
palette-proposal-reject-label = Reject { $id }
palette-proposals-accept-all = Accept all
palette-proposals-reject-all = Reject all
palette-op-tune-default = { $path } = default
palette-op-source = { $tool } (source)
palette-op-place = { $member } → { $to } (place, { $at } ms)
palette-op-prop = { $slot } → { $where } (from { $at } ms)
palette-op-prop-tuned = { $slot } → its tuned place (from { $at } ms)
palette-op-event = { $kind } event at { $at } ms

## "Save camera" and the camera bookmarks of the View tab (CameraSave.vue, useCameraSave.ts).

palette-camera-save = Save camera
palette-camera-name = Camera name
palette-camera-name-hint = Name, for example bay-foot
palette-camera-doc = Doc line
palette-camera-doc-hint = Doc line (optional): what the view shows
palette-camera-replace = Replace a camera of the same name
palette-camera-bookmark = Bookmark
palette-camera-help = The save takes the view of the focused pane and writes it into the cameras module of the plugin (labs camera-save), the dry run first. A bookmark keeps the view in the URL (views=) and writes nothing.
# The status of the run (a data value) comes after the text.
palette-camera-result =
    { $dry ->
        [yes] { $name } (dry run):
       *[no] { $name }:
    }
palette-camera-no-workbench = No workbench: run this command in the repo root.
palette-camera-copy = Copy the command
palette-camera-copied = The command is on the clipboard.
palette-camera-no-clipboard = No clipboard: select the command and copy it.
palette-camera-write = Write { $name } into cameras.ts
palette-camera-open-bookmark = Open the bookmark { $name }
palette-camera-no-view = The save has no view.

## The Light section of the Tune tab (LightSection.vue).

palette-light = Light
palette-light-handle = Handle (I)
palette-light-reset = Reset the light
palette-light-key = Key
palette-light-key-intensity = Key light intensity
palette-light-key-colour = Key light colour
palette-light-fill = Fill
palette-light-fill-intensity = Fill light intensity
palette-light-fill-colour = Fill light colour
palette-light-sky = Sky
palette-light-sky-intensity = Sky light intensity
palette-light-sky-colour = Sky light colour
palette-light-ground = Ground
palette-light-ground-hint = The lower colour of the sky light
palette-light-ground-colour = Ground colour of the sky light
palette-light-help = Drag the dot of the handle to turn the key light (⌘: a proposal). "Save placement" writes the light into the code.
