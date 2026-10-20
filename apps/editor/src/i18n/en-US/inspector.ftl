# SPDX-License-Identifier: Apache-2.0

### The texts of the inspector panel of the scene page (scene/inspector).
### The component names, the field names and the group names come from the component schemas: they are data.

## The panel (InspectorPanel.vue).

inspector-panel = Inspector
inspector-title-scene = Scene
inspector-title-none = No entity
# $count is the number of selected entities (always more than one).
inspector-title-many = { $count } entities
inspector-scene = Scene
inspector-scene-title = Show the scene values
inspector-name = Name
inspector-prefab-entities = Prefab entities
inspector-prefab-instance = Instance
# $count is the number of overrides of the instance or of the entity.
inspector-overridden = { $count } overridden
inspector-prefab-actions = Prefab actions
inspector-prefab-open = Open prefab
inspector-prefab-open-title = Open the prefab file with the editor tools (the prefab mode)
inspector-prefab-apply = Apply to prefab
inspector-prefab-apply-instance = Write the overrides of the instance into the prefab
inspector-prefab-apply-entity = Write the overrides of the entity into the prefab
inspector-prefab-revert-all = Revert all
inspector-prefab-revert-entity = Revert entity
inspector-prefab-revert-instance-title = Remove the overrides of the instance
inspector-prefab-revert-entity-title = Remove the overrides of the entity
inspector-add-label = Add a component
inspector-add = Add component…
# The group of the components that name no group.
inspector-add-other = Other

## One component (ComponentSection.vue). $component is the name of the component.

inspector-component-apply = Apply
inspector-component-apply-title = Apply the overrides of { $component } to the prefab
inspector-component-docs = The docs of { $component }
inspector-component-revert = Revert
inspector-component-revert-title = Revert the overrides of { $component } to the prefab values
inspector-component-remove = Remove { $component }

## One field (FieldRow.vue).

inspector-field-overridden = overridden
inspector-field-overridden-title = Overridden in this instance
inspector-field-mixed = (mixed)
inspector-field-mixed-title = The entities have different values
inspector-field-revert = Revert to the prefab value
inspector-field-reset = Reset to the default

## The widgets. $label is the name of the field.

inspector-drag = Drag to change { $label }
inspector-drag-title = Drag to change { $label } (Shift: ×10, Alt: ×0.1)
# $axis is the name of the axis: X, Y or Z.
inspector-angle = { $label } { $axis } (degrees)
inspector-angle-title = Euler angles in degrees (XYZ)
inspector-colour-hex = { $label } (hex)
inspector-colour-placeholder = #rrggbb
inspector-json-placeholder = JSON
inspector-form = { $label }: form
inspector-form-none = None
inspector-form-object = Object
inspector-form-vector = Point
inspector-form-entity = Entity
inspector-form-asset = Asset
inspector-form-colour = Colour
inspector-form-number = Number
inspector-form-text = Text
inspector-form-switch = Switch
inspector-form-list = List
inspector-form-map = Map
inspector-form-curve = Curve
inspector-asset-pick = Pick an asset
inspector-asset-edit = Edit
inspector-asset-edit-title = Open the material in the material editor
inspector-entity-pick = Pick an entity
inspector-entity-socket = { $label } (socket)
inspector-entity-whole = Whole entity
inspector-list-mixed = The entities differ; an edit writes this value to each.
# $key is the index of a list item or the key of a map item.
inspector-list-remove = Remove { $key }
inspector-list-key = New key
inspector-list-key-label = { $label }: new key
inspector-list-add = Add
inspector-curve-mixed = The entities differ; an edit writes this curve to each.
# $count is the number of keys or points of the curve.
inspector-curve-keys = { $label }: { $count } keys
inspector-curve-points = { $label }: { $count } points
# $index is the number of the key or of the point (the first is 1).
inspector-curve-remove-key = Remove key { $index }
inspector-curve-remove-point = Remove point { $index }
inspector-curve-add-key = Add key
inspector-curve-add-point = Add point

## The titles of the edits in the history (inspectorState.ts). $component is the name of the component and $path the
## path of the field in it.

inspector-edit-field = { $component }: { $path }
inspector-edit-value = { $component }: value
inspector-edit-reset-field = Reset { $component }: { $path }
inspector-edit-reset-value = Reset { $component }: value
inspector-edit-revert-field = Revert { $component }: { $path }
inspector-edit-revert-value = Revert { $component }: value
inspector-edit-rename = Rename
inspector-edit-add = Add { $component }
inspector-edit-remove = Remove { $component }

## The refusals that the panel shows (inspectorState.ts).

inspector-no-prefab-tools = The page has no prefab tools.
inspector-edit-tags = Tags
inspector-edit-show = Show
inspector-edit-hide = Hide
inspector-edit-paste = Paste the values of { $component }
inspector-edit-json = Edit the JSON
inspector-json-one = The JSON mode shows one entity.
inspector-json-object = The JSON of an entity is an object with its name, its tags and its components.
inspector-json-no-ops = The JSON gives no change of the entity.
inspector-id = ID
inspector-id-copy = Copy the ID
inspector-id-copied = The ID is on the clipboard
inspector-hide = Hide the entity
inspector-show = Show the entity
inspector-tags = Tags
inspector-tag-remove = Remove the tag { $tag }
inspector-tag-add = Add a tag
inspector-add-none = No component matches.
inspector-json = The JSON of the entity
inspector-json-apply = Apply
inspector-card-menu = The menu of { $component }
inspector-card-reset = Reset to the defaults
inspector-card-copy = Copy the values
inspector-card-paste = Paste the values
inspector-card-remove = Remove the component
inspector-card-docs = Docs
inspector-card-ask = Ask the agent
inspector-card-ask-prompt = About the component { $component } of the entity { $entity }:
inspector-raw = The raw JSON mode
inspector-lock = Lock the inspector on these entities
inspector-unlock = Follow the selection again

## The live previews of the environment hints. $distance is a distance in metres.

inspector-preview-fog = The fog over the distance: full fog at { $distance } m
inspector-preview-no-fog = No fog: the view is clear at each distance
inspector-preview-bloom = The bloom: the samples brighter than the threshold glow
inspector-preview-ambientOcclusion = The ambient occlusion: the shade in a corner
inspector-preview-selectionOutline = The outline of a selected entity
inspector-preview-off = The effect is off

## The widgets of the models. $level is the number of a level of detail; $place is the place of an override.

inspector-lod-none = The model shows the level of the quality tier. Add a level to choose the levels by the screen size.
inspector-lod-bar = The share of the screen sizes of each level
inspector-lod-level = Level { $level } under
inspector-lod-size = The screen size where level { $level } starts
inspector-lod-hysteresis = Hysteresis
inspector-lod-add = Add a level
inspector-lod-remove = Remove the last level
inspector-pick-part = Pick a part in the view
inspector-pick-part-wait = Click a part in the view…
inspector-pick-part-title = The next click in the Scene view adds an override of the part under it (Escape stops)
inspector-pick-part-none = The click found no part of a model.
inspector-clip-asset = The model of the clips
inspector-clip-rig = The rig profile of the skeleton of the clips
inspector-clip-rig-auto = Auto (from the bone names)
inspector-clip-rig-none = No profile (its own clips only)
inspector-clip-remove = Use the clips of the model
inspector-clip-none = The animator plays the clips of its own model.
inspector-overrides-none = No override: the instance shows the prefab as it is.
inspector-overrides-revert = Revert
inspector-overrides-revert-one = Revert the override of { $place }
inspector-overrides-revert-all = Revert all
inspector-overrides-apply = Apply
inspector-overrides-apply-one = Apply the override of { $place } to the prefab
inspector-prefab-unpack = Unpack
inspector-prefab-unpack-title = The entities of the prefab become plain entities of the scene; the link to the prefab goes

## The presets of the person in the card menu. $name is the name of a preset (data).

inspector-card-save-preset = Save as a preset
inspector-card-apply-preset = Apply the preset { $name }

## The keys of the inspector (with an open sequence).

inspector-key-none = Add a track and a key of this field at the time of the clock
inspector-key-track = Add a key of this field at the time of the clock
inspector-key-key = A key at the time of the clock: set it to this value
inspector-record = Record
inspector-record-title = Record: an edit at the time of the clock becomes a key

## The preview of a sound field.

inspector-sound-play = Play the sound once
inspector-sound-stop = Stop the sound

## The foot lock of an animator. $part is the name of a part of a leg; $leg is the number of the leg.

inspector-foot-upper = Upper bone
inspector-foot-lower = Lower bone
inspector-foot-end = End bone
inspector-foot-follow = Follow bone
inspector-foot-part = { $part } of leg { $leg }
inspector-foot-remove-leg = Remove
inspector-foot-contact = Contact
inspector-foot-contact-title = A foot is in contact when its height is in this lowest share of its range in the clip
inspector-foot-fade = Fade
inspector-foot-fade-title = The share of a contact at each end where the lock fades in and out
inspector-foot-none = No foot lock: the feet move as the clip moves them.
inspector-foot-add = Add the foot lock
inspector-foot-add-leg = Add a leg
inspector-foot-remove = Remove the foot lock

## The IK goals of a character. $goal is the name of a goal.

inspector-ik-left-hand = Left hand
inspector-ik-right-hand = Right hand
inspector-ik-look = Look
inspector-ik-target = The target of { $goal }
inspector-ik-weight = Weight
inspector-ik-angle = Max angle (°)
inspector-ik-remove = Remove
