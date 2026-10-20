# SPDX-License-Identifier: Apache-2.0

### The texts of the hierarchy panel of the scene page (scene/hierarchy).

## The panel (HierarchyPanel.vue).

hierarchy-title = Hierarchy
hierarchy-show-all = Show all
hierarchy-show-all-title = Clear the solo
hierarchy-search-label = Search by name, tag or component
# The words "tag:" and "component:" are search keys. Keep them in English.
hierarchy-search-placeholder = Search: name, tag:…, component:…
hierarchy-tree = Entities
hierarchy-empty = No entity matches.

## One row of the tree (HierarchyRow.vue). $name is the name of the entity.

hierarchy-collapse = Collapse
hierarchy-expand = Expand
hierarchy-rename-field = New name of { $name }
hierarchy-instance = Prefab instance
# $count is the number of overrides of the instance or of the prefab entity.
hierarchy-overrides =
    { $count ->
        [one] { $count } override of the prefab
       *[other] { $count } overrides of the prefab
    }
hierarchy-hide = Hide { $name }
hierarchy-unhide = Show { $name }
hierarchy-hide-title = Hide (saved in the scene)
hierarchy-unhide-title = Show (saved in the scene)
hierarchy-solo = Solo { $name }
hierarchy-solo-title = Solo (editor view only)
hierarchy-lock = Lock { $name }
hierarchy-unlock = Unlock { $name }
hierarchy-lock-title = Lock: no pick and no drag in the viewport (editor view only)

## The context menu (HierarchyMenu.vue, hierarchyState.ts).

hierarchy-menu = Entity actions
hierarchy-menu-add-entity = Add an empty entity
hierarchy-menu-paste = Paste
hierarchy-menu-add-child = Add an empty child
hierarchy-menu-duplicate = Duplicate
hierarchy-menu-copy = Copy
hierarchy-menu-paste-child = Paste as a child
hierarchy-menu-rename = Rename
hierarchy-menu-delete = Delete
hierarchy-menu-prefab-open = Open prefab
# The actions of an instance row: they act on all the overrides of the instance.
hierarchy-menu-prefab-apply = Apply the overrides to the prefab
hierarchy-menu-prefab-revert = Revert the overrides
# The actions of a prefab row: they act on the overrides of that entity of the prefab.
hierarchy-menu-prefab-apply-entity = Apply the overrides of the entity to the prefab
hierarchy-menu-prefab-revert-entity = Revert the overrides of the entity

## The refusals that the panel shows, and the key command (hierarchyState.ts, hierarchyKeys.ts).

hierarchy-no-prefab-tools = The page has no prefab tools.
hierarchy-rename-command = Rename the entity in the hierarchy
hierarchy-rename-none = No entity to rename.
selection-all = Select all
selection-clear = Select none
selection-invert = Invert the selection
selection-children = Select the children
selection-back = Back in the selection
selection-forward = Forward in the selection
selection-none = Nothing is selected.
selection-history-start = No selection before this one.
selection-history-end = No selection after this one.
selection-by-tag = Select by tag
selection-by-tag-label = The tag
selection-by-component = Select by component
selection-by-component-label = The component ID, for example light
selection-by-kind = Select by kind
selection-by-kind-label = The kind: model, light, camera, sound or note
hierarchy-create = Create an entity

## The inputs of the create presets and the camera from the view.

create-ask-prefab = Create a prefab instance
create-ask-prefab-label = The prefab: a .prefab.json path or asset:<id>
create-ask-character = Create a character
create-ask-character-label = The model of the character: asset:<id>
create-ask-cancelled = The create stopped: no input.
create-camera-from-view = Create a camera from the view
create-camera-from-view-none = The view has no camera yet.
create-camera-name = Camera
hierarchy-menu-prefab-unpack = Unpack the instance

## The Tags panel. $name is a tag or a pick layer (data).

panel-tags = Tags
tags-tags = Tags
tags-layers = Pick layers
tags-none = None in the scene.
tags-select = Select the entities with { $name }
tags-rename = Rename
tags-rename-label = The new name of { $name }

## The notes of the scene. $text is the text of a note and $entity an entity ID (data); $count is a number.

panel-notes = Notes
hierarchy-notes =
    { $count ->
        [one] One note on this entity
       *[other] { $count } notes on this entity
    }
notes-pin = Note: { $text }
notes-filter = The notes that show
notes-filter-all = All notes
notes-filter-open = Open notes
notes-filter-done = Done notes
notes-filter-none = No pins
notes-count =
    { $count ->
        [one] One note
       *[other] { $count } notes
    }
notes-new = A new note on the selection (or at the view)
notes-add = Add
notes-done = Done
notes-open = Open
notes-send = Send
notes-remove = Remove
# The thread of a note.
notes-thread = { $count ->
    [0] Reply
    [one] 1 reply
   *[other] { $count } replies
}
notes-reply = A reply
notes-reply-send = Reply
notes-reply-anonymous = Someone
notes-send-prompt = A note on { $entity }: { $text }
