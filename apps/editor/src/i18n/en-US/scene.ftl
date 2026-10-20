# SPDX-License-Identifier: Apache-2.0

### The texts of the scene page shell: the file bar, its notices, the proposal
### card, the inspect panel and the error texts of the page.

## The page title and the file bar. The specs read the state texts: keep them as they are.

scene-page-title = Scenity scene
scene-page-title-dirty = * Scenity scene
scene-bar-save = Save
scene-bar-save-title = Save the scene file (⌘S)
scene-state-saved = saved
scene-state-unsaved = unsaved
scene-state-saving = saving
scene-state-rule-fails = not saved: a rule fails
scene-state-not-saved = not saved: { $reason }

## The refusals of a save.

scene-save-no-edit-mode = The page has no edit mode (edit=1).
scene-save-drag = A drag runs.
scene-save-play = Stop the play mode before a save.
scene-file-save-failed = the save failed ({ $status })
scene-file-create-failed = the create failed ({ $status })

## The notices of the file bar: a rule that fails, a local draft, a file that changed on the disk. Each one is a
## dialog of the editor window with a title.

scene-notice-title-draft = Restore the draft?
scene-notice-title-conflict = The file changed on the disk
scene-notice-title-rules = A rule stops the save
scene-notice-title-scene = Scenes

scene-rules-notice = Not saved. { $reason }
scene-rules-reason = Reason to save anyway (it goes into the log next to the scene)
scene-rules-save = Save with the reason
scene-notice-cancel = Cancel
scene-draft-offer = A local draft of this scene from { $time } has changes that are not saved.
scene-draft-offer-stale = A local draft of this scene from { $time } has changes that are not saved. The file changed on the disk after the draft.
scene-draft-restore = Restore
scene-draft-discard = Discard
scene-draft-changes = The changes of the draft
# The upgrade of a file of an older format.
scene-upgrade-title = Upgrade the file format
scene-upgrade-text = This file has the format { $from }. The editor reads it as { $to }; Upgrade saves the file in that format.
scene-upgrade-changes = The changes of the file
scene-upgrade-save = Upgrade
scene-upgrade-later = Not now
scene-draft-none = No draft.
scene-draft-unread = The draft does not read: { $reason }
scene-conflict = The scene file changed on the disk after the load. Reload it (your changes go) or overwrite it.
scene-conflict-reload = Reload
scene-conflict-overwrite = Overwrite

## The titles of the history steps of the page. A change of the view state or of the prefab set outside an edit
## gets the title of its channel.

scene-history-edit = Edit
scene-history-restore-draft = Restore the draft
scene-history-view = view
scene-history-prefabs = prefabs

## The proposal card: the edits of Claude that wait for the owner.

scene-proposals = Proposals
scene-proposals-count = Proposals: { $count }
scene-proposal-claude = { $title } (Claude)
scene-proposal-by = { $title } ({ $by })
scene-proposal-accept = Accept
scene-proposal-reject = Reject

## The inspect panel. The cells and the detail are raw data of the report: they stay as they are.

scene-inspect = Inspect
scene-inspect-refresh = Refresh
scene-inspect-layers = Debug layers
scene-inspect-totals = { $entities } entities, { $triangles } triangles, { $calls } own draw calls
scene-inspect-head-entity = Entity
scene-inspect-head-components = Components
scene-inspect-head-position = Position
scene-inspect-head-size = Size
scene-inspect-head-triangles = Triangles
scene-inspect-head-draws = Draws
scene-inspect-head-batch = Batch
scene-inspect-head-joints = Joints
scene-inspect-batched = yes
scene-inspect-toggle = Open or close the inspect panel

## The rules of the page.

scene-rules-file-unread = the rules file does not read

## The error texts of the page. The status line shows them after "Scene error".

scene-error = Scene error: { $reason }
scene-error-project = "{ $project }" is not a project name
scene-error-no-canvas = the page has no canvas
scene-error-no-camera = no camera "{ $camera }"
scene-error-tier = "{ $tier }" is not a quality tier
scene-error-output = "{ $output }" is not an output folder of the project
scene-error-origin = "{ $origin }" is not an asset origin
scene-error-no-build = the project at { $base } has no build
scene-error-no-scene = no scene at { $url } ({ $status })
scene-error-no-scene-list = no scene list at { $base } ({ $status })
scene-error-no-sequence = no sequence at { $url } ({ $status })
scene-error-no-index = no asset index at { $base } ({ $status })

## The scene page with no project in its address (projects/noProject.ts).

scene-no-project = No project is open. Run scenity studio to open the Hub with your projects, or scenity dev in a project folder.

## The file and project commands.

command-scene-new = New scene
command-scene-open = Open a scene
command-scene-save = Save the scene
command-scene-save-as = Save the scene as
command-scene-close = Close the scene
command-sequence-new = New sequence
command-sequence-open = Open a sequence
command-sequence-path = A sequence path ends with .sequence.json.
command-arg-sequence-path = The path of the sequence file in the project.
command-prefab-create = Make a prefab of the selection
command-prefab-variant = Make a variant of the prefab
command-prefab-variant-none = Select an instance of a prefab first.
command-prefab-variant-asset = A variant needs a prefab file of the project, not a prefab asset.
command-material-new = New material
command-project-set = Set a project setting
command-name = Name
command-path = Path in the project
command-prompt-go = OK
command-prompt-cancel = Cancel
command-no-scenes = This page edits no scene file.
command-no-materials = This page has no material editor.
command-prefab-none = Select the entities of the prefab first.
command-file-made = Made { $path }
command-conflict = The file changed on the disk.
command-project-json = The value is no JSON value: { $value }
command-failed = { $id } did not run
command-arg-path = The path of the scene file in the project.
command-arg-scene-name = The name of the new scene.
command-arg-file-name = The name of the new file.
command-arg-root = The root entity (default: the selected entity).
command-arg-instance = The instance of the prefab (default: the selected entity).
command-arg-setting = The setting of the project.
command-arg-value = The value as JSON, for example 0.05 or "animate".

## Adjust the last action.

adjust-label = Adjust the last action
adjust-title = Adjust: { $title }
adjust-close = Close the adjust panel

## The document sync of the studio.

sync-remote-title = A change from another window
sync-again-title = Your change, after the change of another window

## The title of the window.

window-title = { $scene } · { $project } · Scenity
window-title-dirty = * { $scene } · { $project } · Scenity

diff-add = { $name }: new entity
diff-remove = { $name }: removed
diff-move = { $name }: moved under { $parent }
diff-move-root = { $name }: moved to the root
diff-add-component = { $name }: new component { $component }
diff-remove-component = { $name }: component { $component } removed
diff-set = { $name }: { $field } { $before } → { $after }
diff-set-scene = Scene: { $field } { $before } → { $after }
diff-unknown = The changes do not show as a list.
diff-more = { $count ->
    [one] 1 more change
   *[other] { $count } more changes
}
scene-conflict-diff = See the diff
scene-conflict-diff-none = The file on the disk has the same scene.

## A prefab from the selection. $name is the name of the new prefab (data).

command-prefab-made = Make the prefab { $name }
command-prefab-variant-made = Make the variant { $name }
command-arg-folder = The folder of the project for the new prefab (default: prefabs).
command-arg-replace = False: write the prefab file only, and keep the selection as it is.

## The placement helpers (Entity ▸ Place). $entity is an entity ID (data).

place-command-align = Align the selection on an axis
place-command-spread = Spread the selection on an axis
place-command-dropToFloor = Drop to the floor
place-command-on = Put on a target
place-command-against = Put against a side of a target
place-command-near = Put near a target
place-command-facing = Turn to face a target
place-command-findSpace = Find a free place on the floor
place-no-entities = Select the entities to place first.
place-no-report = The view gives no boxes of the entities yet.
place-no-box = The entity { $entity } has no box in the view.
place-no-space = No free place near { $entity }.
place-arg-entities = The entity IDs with commas (default: the selection).
place-arg-entity = One entity ID (default: the selection).
place-arg-target = The ID of the target entity.
place-arg-axis = x, y or z (default x).
place-arg-edge = min, centre or max (default min).
place-arg-side = +x, -x, +z or -z (default +x).
place-arg-angle = The direction about the up axis in degrees (0: +Z, 90: +X).
place-arg-gap = The space between the two boxes in metres (default 0.3).
place-arg-face = True: the entity turns to face the target.
place-arg-near = Look for a place near this entity (default: where the entity is).

## The toast of a hot reload of an asset. $file is a file of the project (data).

scene-asset-reloaded = { $file } changed: the view shows the new import.
scene-asset-reload-failed = { $file } changed, but the new import did not load.
