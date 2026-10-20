# SPDX-License-Identifier: Apache-2.0

### The commands of the scene editor of the lab page (apps/editor/src/core/editor): the titles, the keys and
### the argument docs that the palette shows, the titles of the edits that the history and the cards show, and the
### refusals. Claude and the scripts get the same texts in the page locale. Keep the English text: the tools and the
### specs read it. A variable that holds a number gets a text, so Fluent does not format it again.

## The prop and scratch commands (propCommands.ts): the titles, the keys, the argument docs of the palette form, the
## titles of the edits and the refusals.

commands-prop-select = Select a prop, or name it with the prop argument.
commands-prop-no-place = The prop "{ $slot }" has no tuned place. Props: { $props }.
commands-prop-arg-prop = The prop slot, for example 'cart' or 'pillow'. Default: the selected prop.
commands-prop-arg-x = The new x of the place (metres, east). Default: the x now.
commands-prop-arg-z = The new z of the place (metres, south). Default: the z now.
commands-prop-arg-height = The new height (metres). Default: the height now.
commands-prop-move = Move the prop over the floor
commands-prop-move-key = Drag (Shift: 10 cm grid)
commands-prop-move-needs = prop.move needs x, z or both.
commands-prop-move-edit = Move { $slot } to x { $x }, z { $z }
commands-prop-lift = Lift the prop
commands-prop-lift-key = Alt+drag
commands-prop-lift-arg-y = The new height of the place (metres above the floor).
commands-prop-lift-edit = Lift { $slot } to { $y } m
commands-prop-turn = Turn the prop
commands-prop-turn-key = R (Shift+R: back, Alt+R: 1°)
commands-prop-turn-arg-degrees = The turn about the vertical (degrees, + is counterclockwise).
commands-prop-turn-edit = Turn { $slot } { $degrees }°
commands-prop-nudge = Nudge the prop one step
commands-prop-nudge-key = Alt+arrows, Alt+Q/E, Alt+comma/period (Tune tab)
commands-prop-nudge-arg-axis = The part of the place: x, y, z or yaw.
commands-prop-nudge-arg-steps = The number of steps (1 cm or 1° each; a minus number goes the other way).
commands-prop-nudge-edit = Nudge { $slot } { $axis } { $steps }
commands-prop-reset = Put the prop back to its place in the code
commands-prop-reset-edit = Reset { $slot }

## The scratch props.

commands-prop-scratch-select = Select a scratch prop.
commands-prop-scratch-none = No scratch prop "{ $id }".
commands-prop-scratch-arg-x = The new x (metres). Default: the x now.
commands-prop-scratch-arg-z = The new z (metres). Default: the z now.
commands-prop-scratch-move = Move the scratch prop
commands-prop-scratch-move-key = Drag
commands-prop-scratch-move-edit = Move { $id }
commands-prop-scratch-turn = Turn the scratch prop
commands-prop-scratch-turn-arg-degrees = The turn about the vertical (degrees).
commands-prop-scratch-duplicate = Duplicate the scratch prop
commands-prop-scratch-duplicate-edit = Duplicate { $id }
commands-prop-scratch-remove = Delete the scratch prop
commands-prop-scratch-remove-edit = Delete { $id }
commands-prop-scratch-promote = Promote the scratch prop to the room
commands-prop-scratch-promote-arg-dry = True: the dry run (what will change); false: send the prepared prompt to Claude.
commands-prop-scratch-promote-edit =
    { $dry ->
        [yes] Promote { $id } (dry run)
       *[no] Promote { $id }
    }

## The snap commands (snapCommands.ts) and the snap refusals (snapPlace.ts).

commands-snap-prop = Snap the prop to a target of the room
commands-snap-prop-key = Drag (hold Alt: no snap)
commands-snap-prop-arg-target = The target ID (surface:floor, surface:cart, wall:head, socket:wall_outlet, anchor:door, …; the end after the colon is enough when it is unique), or 'nearest' (within 8 cm).
commands-snap-no-target = No snap target "{ $name }". Targets: { $targets }.
commands-snap-no-port = No snap to { $id }: { $slot } has no port (*_port).
commands-snap-not-along = No snap to { $id }: the place is not along it.
commands-snap-prop-edit = Snap { $slot } to the { $label } ({ $id })
commands-snap-prop-edit-surface = Snap { $slot } to the { $label } ({ $id }); no other target within { $radius } cm
commands-snap-prop-edit-none = Snap { $slot }: no target within { $radius } cm
commands-snap-place = Set the place of the prop
commands-snap-place-key = ⌘+drag with a snap (a proposal)
commands-snap-place-arg-yaw = The new turn about the vertical (radians, as the tune value). Default: the turn now.
commands-snap-place-needs = prop.place needs x, y, z or yaw.
commands-snap-place-edit = Place { $slot } at x { $x }, y { $y }, z { $z }, turn { $turn } rad

## The multi-select and group commands (groupCommands.ts) and the group refusals (groups.ts).

commands-group-no-host = This page keeps no groups.
commands-group-arg-props = The prop slots, for example 'cart,pillow' (default: the selected props).
commands-group-add = Add an item to the selection (or take it out)
commands-group-add-key = Shift+click
commands-group-add-arg-target = The item as kind:id, for example 'prop:cart' (a selected item goes out of the selection).
commands-group-not-item = "{ $text }" is not an item (kind:id).
# $out is "yes" when the item goes out of the selection.
commands-group-add-edit =
    { $out ->
        [yes] Unselect { $item }
       *[no] Add { $item }
    }
commands-group-select = Select the named group of the selected prop
commands-group-select-arg-group = The name of a group, for example 'crash-cart' (default: the group of the selected prop).
commands-group-none-of = { $prop } is in no group. Groups: { $known }.
commands-group-unknown = No group "{ $name }": { $known }.
commands-group-select-edit = Select the group { $name }
commands-group-move = Move props together (the selected props or a group)
commands-group-move-key = Drag a selected prop
commands-group-move-arg-about = The prop that the move and the turn are of (default: the first prop).
commands-group-move-arg-dx = The move along x (metres, east).
commands-group-move-arg-dy = The move up (metres).
commands-group-move-arg-dz = The move along z (metres, south).
commands-group-move-arg-degrees = The turn about the vertical through the about prop (°).
commands-group-move-no-place = The prop "{ $slot }" has no tuned place.
commands-group-move-edit = Move { $props } by x { $dx }, y { $dy }, z { $dz }
commands-group-move-edit-turn = Move { $props } by x { $dx }, y { $dy }, z { $dz }, turn { $degrees }°
commands-group-save = Keep the selected props as a named group
commands-group-save-arg-name = The name of the group, for example 'west-corner' (a-z, 0-9, _ and -).
commands-group-save-few = A group has two or more props: select them, or name them.
commands-group-save-edit = Keep the group { $name }
commands-group-remove = Take a group of the owner out
commands-group-remove-arg-name = The name of a group of the owner (not a built-in group).
commands-group-remove-edit = Take the group { $name } out
commands-group-list = List the named groups
commands-group-bad-name = "{ $name }" is not a group name (a-z, 0-9, _ and -; at most 24 characters).
commands-group-built-in = "{ $name }" is a built-in group.
commands-group-few-slots = A group has two or more prop slots.

## The light commands (lightCommands.ts) and the label of the key light handle (lightEdit.ts). The $part
## variable is the value of the part argument (key, fill, sky or ground).

commands-light-no-tunables = The runtime has no light tunables (model/light.ts).
commands-light-no-host = This page has no key light handle.
commands-light-arg-x = The x (metres, east). Default: the x now.
commands-light-arg-y = The height (metres). Default: the height now.
commands-light-arg-z = The z (metres, south). Default: the z now.
commands-light-needs = { $command } needs x, y, z or all.
commands-light-section-key = The Light section of the Tune tab
commands-light-move = Move a light
commands-light-move-key = Drag the key light handle (I)
commands-light-move-arg-part = The light: key or fill.
commands-light-move-same = The { $part } light is there already.
commands-light-move-edit = Move the { $part } light to { $at }
commands-light-aim = Aim the key light
commands-light-aim-same = The key light aims there already.
commands-light-aim-edit = Aim the key light at { $at }
commands-light-intensity = Set the intensity of a light
commands-light-intensity-arg-part = The light: key, fill or sky.
commands-light-intensity-arg-value = The intensity (the key light of the code: 2.1).
commands-light-intensity-same = The { $part } light has that intensity already.
commands-light-intensity-edit = Set the { $part } light to { $value }
commands-light-colour = Set the colour of a light
commands-light-colour-arg-part = The colour: key, fill, sky, or ground (the lower colour of the sky light).
commands-light-colour-arg-colour = The colour: '#rrggbb', or 'r,g,b' with each channel 0 to 255 (sRGB).
commands-light-colour-bad = The colour is '#rrggbb' or 'r,g,b' (0 to 255).
commands-light-colour-same = The { $part } colour is { $hex } already.
commands-light-colour-edit = Set the { $part } colour to { $hex }
commands-light-reset = Put the light back to its values in the code
commands-light-reset-arg-part = The light: key, fill or sky (default: the whole light).
commands-light-reset-none = The light has no tuned values there.
commands-light-reset-edit = Reset the light
commands-light-reset-edit-part = Reset the { $part } light
commands-light-show = Show the key light handle
commands-light-show-arg-on = Show or hide (default: turn it over).
commands-light-hide-edit = Hide the key light handle
commands-light-handle-label = key light · { $intensity } · { $up }° up, turn { $turn }°
commands-light-handle-label-drag = key light · { $intensity } · { $up }° up, turn { $turn }° · drag the dot

## The camera commands (cameraCommands.ts).

commands-camera-no-camera = This page has no camera to save.
commands-camera-no-bookmarks = This page has no camera bookmarks.
commands-camera-arg-name = The name: small letters and digits, a hyphen between parts (for example 'bay-foot').
commands-camera-save = Save camera
commands-camera-save-arg-dry = True: the dry run (the lines that change); false: write the camera into cameras.ts.
commands-camera-save-arg-replace = True replaces a named camera of the same name; false refuses an existing name.
commands-camera-save-arg-doc = The doc line of the camera in cameras.ts (one short sentence).
commands-camera-save-exists = The camera "{ $name }" exists: give another name, or replace it (replace: true).
commands-camera-save-edit =
    { $dry ->
        [yes] Save camera { $name } (dry run)
       *[no] Save camera { $name }
    }
commands-camera-bookmark = Bookmark the view
commands-camera-bookmark-edit = Bookmark the view as { $name }
commands-camera-recall = Open a bookmarked view
commands-camera-recall-arg-name = The name of a bookmark of the URL (views=).
commands-camera-recall-none = No bookmarks: bookmark a view first.
commands-camera-recall-unknown = No bookmark "{ $name }". Bookmarks: { $names }.
commands-camera-recall-edit = Open the bookmark { $name }

## The view commands (viewCommands.ts): the selection, the history, the named cameras, the marks and the ask.

commands-view-select = Select an item
commands-view-select-key = Click
commands-view-select-arg-target = The item as kind:id, for example 'prop:cart', 'member:bo', 'scratch:s1'.
commands-view-select-bad = "{ $text }" is not an item. Give kind:id with a kind of { $kinds }.
commands-view-select-edit = Select { $text }
commands-view-clear = Clear the selection
commands-view-undo = Undo
commands-view-undo-none = Nothing to undo.
commands-view-redo = Redo
commands-view-redo-none = Nothing to redo.
commands-view-camera = Open a named camera
commands-view-camera-arg-name = The named camera (cameras.ts).
commands-view-camera-unknown = No camera "{ $name }".
commands-view-camera-edit = Open the camera { $name }
commands-view-marks-start = Draw marks on the frame
commands-view-marks-start-busy = The owner draws marks now.
commands-view-marks-start-edit = Draw marks
commands-view-marks-stop = Stop the marks
commands-view-marks-stop-none = No marks are in progress.
commands-view-marks-clear = Clear the marks
commands-view-marks-clear-none = The frame has no marks.
commands-view-ask = Ask Claude about the selection
commands-view-ask-arg-text = The request, for example 'move this closer to the wall'.
commands-view-ask-edit = Ask Claude

## "Save placement".

commands-view-placement-save = Save placement
commands-view-placement-save-arg-dry = True: the dry run (the lines that change); false: write the places into the runtime source.
commands-view-placement-save-arg-override = The reason to save while a layout check fails (the checks show the numbers); it goes with the placement.
commands-view-placement-save-none = No place values: move a prop first.
# $dry and $override are "yes" or "no".
commands-view-placement-save-edit =
    { $dry ->
        [yes]
            { $override ->
                [yes] Save placement (dry run) (layout override)
               *[no] Save placement (dry run)
            }
       *[no]
            { $override ->
                [yes] Save placement (layout override)
               *[no] Save placement
            }
    }

## The proposals of the owner (proposal.*).

commands-view-proposal-arg-id = The ID of the proposal, for example 'p1'.
commands-view-proposal-none = No proposals wait.
commands-view-proposal-accept = Accept a proposal
commands-view-proposal-accept-edit = Accept { $id }
commands-view-proposal-reject = Reject a proposal
commands-view-proposal-reject-edit = Reject { $id }
commands-view-proposal-accept-all = Accept all proposals
commands-view-proposal-reject-all = Reject all proposals

## The names of the history steps that no command made (editHistory.ts): the input that changed.

commands-view-history-tunes = tune values
commands-view-history-events = events
commands-view-history-scratch = scratch props

## The solo and hide commands (hideCommands.ts). $all is "yes" for every pane, else "no".

commands-hide-arg-all = True: every pane; false: the focused pane only (the main pane without the split screen).
commands-hide-arg-target = The items as kind:id, for example 'prop:cart,prop:pillow' (default: the selected items).
commands-hide-no-host = This page has no solo and hide.
commands-hide-select = Select the items first.
commands-hide-no-item = "{ $text }" names no item (kind:id).
commands-hide-hide = Hide the selected items
commands-hide-hide-edit =
    { $all ->
        [yes] Hide { $count } item(s) in every pane
       *[no] Hide { $count } item(s) in the focused pane
    }
commands-hide-solo = Show only the selected items
commands-hide-solo-edit =
    { $all ->
        [yes] Show only { $items } in every pane
       *[no] Show only { $items } in the focused pane
    }
commands-hide-show-all = Show every item again
commands-hide-show-all-edit =
    { $all ->
        [yes] Show every item in every pane
       *[no] Show every item in the focused pane
    }

## The measure commands (measureCommands.ts) and the measure tool (measure.ts, useMeasure.ts).

commands-measure-no-host = This page has no measure tool.
# $which is "first" or "second"; $forms is commands-measure-forms.
commands-measure-arg-end =
    { $which ->
        [first] The first end: { $forms }.
       *[second] The second end: { $forms }.
    }
commands-measure-start = Measure between two picks
commands-measure-start-edit = Measure: pick two points
commands-measure-between = Measure between two points or items
commands-measure-between-edit = Measure { $from } to { $to }
commands-measure-clear = Clear the measurements
commands-measure-clear-key = Escape (no selection)
commands-measure-forms = x,y,z (metres), prop:<slot>, member:<id> or member:<id>.<joint> (for example member:cy.wrist_r), point:<work point>
commands-measure-forms-named = x,y,z (metres), prop:<slot>, member:<id> or member:<id>.<joint> (for example member:cy.wrist_r), point:<work point> or { $named }
commands-measure-named-end = { $name } (the { $point } point)
commands-measure-end = { $what } ({ $at })
commands-measure-text = { $id }: { $cm } cm (horizontal { $horizontal }, vertical { $vertical }) from { $from } to { $to }
commands-measure-label = { $cm } cm · h { $horizontal } · v { $vertical }
commands-measure-label-named = { $id } { $cm } cm · h { $horizontal } · v { $vertical }
commands-measure-no-members = none
commands-measure-no-member = No member "{ $id }" in the last frame (members: { $ids }).
commands-measure-no-joint = No joint "{ $joint }" of { $id } (joints: { $joints }).
commands-measure-no-prop = No prop "{ $slot }" with a place.
commands-measure-no-point = No work point "{ $name }" in the last frame.
commands-measure-bad-end = "{ $text }" is not an end. Give { $forms }.
commands-measure-status-first = Measure: click the first point.
commands-measure-status-second = Measure: click the second point.
commands-measure-status-miss = Measure: nothing under the point. Click a point of the scene.

## The onion skin command (onionCommands.ts) and the words of its state (onion.ts).

commands-onion = Onion skin: the poses before and after the clock time
commands-onion-arg-on = True shows the onion skin, false hides it; without it the onion skin turns over.
commands-onion-arg-step = The time between two copies in ms (default 250).
commands-onion-arg-count = The copies on each side of the clock time (default 2: five poses with the pose now).
commands-onion-arg-capture = True: every capture (a sheet, lab_frame) shows the onion skin too; default false.
commands-onion-no-host = This page has no onion skin.
commands-onion-edit = Show or hide the onion skin
commands-onion-edit-show = Show the onion skin
commands-onion-edit-hide = Hide the onion skin
commands-onion-words-off = onion skin off
commands-onion-words = onion skin ±{ $step } ms × { $count } (blue before, orange after)
commands-onion-words-capture = onion skin ±{ $step } ms × { $count } (blue before, orange after; in the captures)

## The refusals of a layout variant (layoutFiles.ts, layoutIndex.ts). The lab CLI (labs layout-save) and the
## layout commands of the plugin show them.

commands-layout-name-length = A layout name has 1 to { $max } characters.
commands-layout-name-bad = "{ $name }" is not a layout name: use small letters and digits, with a hyphen between parts (bay-b).
commands-layout-name-word = "{ $name }" is a word of the commands: give another name.
commands-layout-name-variant = "{ $name }" is the ID of a search variant: give another name.
commands-layout-doc-length = The doc line of a layout has at most { $max } characters.
commands-layout-doc-bad = The doc line of a layout has no line break and none of ; | & $ ` < > \ ".
commands-layout-not-place = { $path } is not a place of a layout ({ $prefixes }).
commands-layout-not-tuned = { $path } is not a tuned number.
commands-layout-not-finite = The value of { $path } is not a finite number.
commands-layout-bad-file = { $name }.json is not a layout (name, doc, camera, tunes of room.props.* and routes.*).

## The reasons and the titles of the scene commands of the core in the menus.

command-needs = Select { $kinds } first.
command-needs-or-arg = Select { $kinds } first (or give the { $arg } argument).
command-kind-any = something
command-kind-entity = an entity
command-kind-or = { " " }or{ " " }
command-reason-no-solo = No entity is solo.
command-reason-clipboard-empty = The clipboard is empty.
settings-command-component-add = Add a component to the entities
settings-command-component-remove = Remove a component from the entities
