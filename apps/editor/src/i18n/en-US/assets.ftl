# SPDX-License-Identifier: Apache-2.0

### The texts of the asset browser (assetBrowser/; scene docks). The scene page shows it in the bottom dock,
### and the lab shows it in the Assets tab of its dock. Asset IDs, names, kinds, tags, sources and paths are data values.

## The tool bar: the search, the kind and tag filters, the count, the reload and the import.

assets-browser = Assets
assets-search = Search assets
assets-kinds = Kinds
assets-tags = Tags
# $shown is the count of the assets that pass the filters, $total the count of all assets.
assets-shown = { $shown } of { $total }
assets-reload = Read the assets again
assets-import = Import
# $extensions is the list of the file extensions that an importer reads (data values).
assets-import-title = Import files ({ $extensions }); or drop them on the browser
assets-import-files = Import files

## The grid and the tiles.

assets-empty = No asset records in this project.
assets-empty-importable = No asset records in this project. Drop files here to import them.
# The tooltip of a tile: the source file, the asset ID and the tags of the asset.
assets-tile-hint =
    Source: { $source }
    ID: { $id }
    Tags: { $tags }
assets-tile-hint-untagged =
    Source: { $source }
    ID: { $id }
# The badge of a tile with a problem of the asset database.
assets-problem = problem

## The details of the selected asset. $count is a number of triangles or of levels of detail.

assets-size-bytes = { $size } B
assets-size-kilobytes = { $size } KB
assets-size-megabytes = { $size } MB
assets-open-prefab = Open prefab
    .title = Open the prefab file with the editor tools (the prefab mode)
assets-edit-material = Edit material
    .title = Open the material in the material editor
assets-used-by = Used by
assets-unused = Nothing uses this asset.

## The status line of an import. $file is the name of the file, $source the source path of the new asset.

assets-importing = Importing { $file }…
assets-imported = Imported { $file } as { $source }
# $warnings is the list of the warnings of the importer (from the dev server, in English).
assets-imported-warnings = Imported { $file } as { $source } ({ $warnings })
# $reason comes from the dev server (in English).
assets-import-failed = { $file } did not import: { $reason }
# A failed request with no reason. $status is the HTTP status code, $text the HTTP status text.
assets-server-answered = the server answered { $status } { $text }
assets-no-server = No asset list on this server. Open the project in the studio or with the dev server.
project-failed = The dev server did not answer.
project-folders = The folders of the project
project-favourites = Favourites
project-assets = Assets
project-root = The project folder
project-search = Search the files
project-kind = Kind
project-kind-all = All kinds
project-kind-folder = Folders
project-kind-scene = Scenes
project-kind-prefab = Prefabs
project-kind-material = Materials
project-kind-sequence = Sequences
project-kind-rules = Rules
project-kind-plugin = Plugins
project-kind-asset = Assets
project-kind-file = Other files
project-create = Create
project-new-folder = New folder
project-new-folder-name = New folder
project-new-scene = New scene
project-new-material = New material
project-new-sequence = New sequence
project-grid = Show a grid
project-list = Show a list
project-empty = No file here.
project-entries = The files of the folder
project-rename = Rename { $name }
project-favourite = Keep { $name } in the favourites
project-reveal = Show { $name } on the disk
project-reveal-short = Reveal

## The import dialog and the import queue. $count is a count of files; $field is a setting (data).

assets-import-dialog = Import
assets-import-dialog-title = { $count ->
    [one] Import 1 file
   *[other] Import { $count } files
}
assets-import-no-importer = No importer
assets-import-more = More settings
assets-import-rights = Rights record
assets-import-rights-default = rights/imports.yaml (the default: the licence is not known yet)
assets-import-folder = Folder
assets-import-start = Import
assets-import-cancel = Cancel
assets-import-setting-bad = The setting { $field } does not read.
assets-import-queue = The import queue
assets-import-state-waiting = Waits
assets-import-state-importing = Imports…
assets-import-state-done = Done
assets-import-state-failed = Failed
assets-import-state-cancelled = Cancelled
assets-import-queue-cancel = Cancel the other files
assets-import-fix-blender = FBX, OBJ and .blend files need Blender 5.2. The doctor of the Hub checks it.
assets-import-fix-blender-link = Install Blender
assets-import-folder-default = assets/sources
assets-import-new-rights = New record…

## The form of a new rights record.

rights-name = Name
rights-name-sample = kenney
rights-source = Source
rights-author = Author
rights-spdx = SPDX ID
rights-licence = Licence
rights-date = Licence date
rights-uses = Allowed use
rights-delivery = Web delivery
rights-delivery-yes = Allowed
rights-delivery-pending = Asked, no answer yet
rights-delivery-no = Not allowed
rights-save = Save the record

## The asset inspector.

asset-inspector = Asset inspector
asset-preview-channels = Channels
asset-preview-channel-rgb = RGB
asset-preview-channel-r = Red
asset-preview-channel-g = Green
asset-preview-channel-b = Blue
asset-preview-channel-a = Alpha
asset-preview-player = Play the sound
asset-fact-size = Size
asset-fact-triangles = Triangles
asset-fact-meshes = Meshes
asset-fact-extent = Extent
asset-fact-lods = LODs
asset-fact-clips = Clips
asset-fact-rig = Rig
asset-fact-joints = Joints
asset-fact-pixels = Pixels
asset-fact-type = Type
asset-fact-duration = Length
asset-fact-channels = Channels
asset-fact-codec = Codec
asset-record-importer = Importer
asset-record-source = Source
asset-record-rights = Rights
asset-record-tags = Tags
asset-record-build = Build
asset-record-approvals = Approvals
asset-reimport = Import again
asset-reimport-start = Import again

## The stills.

assets-make-stills = Make stills ({ $count })
assets-make-stills-hint = Draw the missing and stale stills of the project in this page
assets-stills-drawing = Draws still { $index } of { $count }…
assets-stills-made = { $count ->
    [one] Made 1 still
   *[other] Made { $count } stills
}
assets-stills-failed = Some stills failed: { $reasons }
assets-no-project-folder = { $base } is not a project folder
assets-still-stale = Stale
assets-still-stale-hint = The source or the build changed after the still: Make stills draws it again

## The asset build panel.

panel-asset-build = Asset build
asset-build = Asset build
asset-build-assets = Assets of the build
asset-build-run = Run the build
asset-build-running = The build runs…
asset-build-ok = The build is done
asset-build-failed = The build failed: see the log
asset-build-count-built = { $count } built
asset-build-count-stale = { $count } stale
asset-build-count-unbuilt = { $count } not built
asset-build-count-failed = { $count } failed
asset-build-state-built = Built
asset-build-state-stale = Stale
asset-build-state-unbuilt = Not built
asset-build-state-failed = Failed
asset-build-codec-color = Colour textures
asset-build-codec-normal = Normal maps
asset-build-codec-data = Data textures
asset-build-codec-environment = Environment map
asset-build-project = As the project
asset-build-lods = Levels of detail
asset-build-lods-bad = The levels of detail are a number from 1 to 8.
asset-build-save = Save the settings
asset-build-saved = The record has the new build settings. Run the build to use them.
asset-build-levels = Levels of the build
asset-build-triangles = { $count } triangles
asset-build-preview = Preview

## The rights of many assets and the licence policy.

assets-rights-mark = Rights
assets-agent-mark = { $name } changed this asset in turn { $turn }
assets-rights-bar = Picked assets
assets-picked = { $count ->
    [one] 1 asset picked
   *[other] { $count } assets picked
}
assets-picked-clear = Clear
assets-rights-record = Rights record
assets-rights-assign = Give the rights record
assets-rights-assigned = { $count ->
    [one] 1 asset has the rights record { $rights }
   *[other] { $count } assets have the rights record { $rights }
}
panel-rights = Rights
rights-panel = Rights and licences
rights-policy = Licences of a release
rights-policy-hint = The release gate accepts a rights record when the project accepts its SPDX ID.
rights-policy-none = The project accepts no licence: the release gate stops each asset.
rights-policy-remove = Remove { $id }
rights-policy-add = SPDX ID
rights-policy-add-button = Accept
rights-records = Rights records of the project
rights-not-accepted = The project does not accept this licence

## The approvals.

panel-approvals = Approvals
approvals = Approvals
approvals-role = Role
approvals-queue = Assets of the role
approvals-refresh = Read again
approvals-new-role = New role
approvals-new-label = Label
approvals-add-role = Add the role
approvals-no-role = The project has no approval role. Add one: the release gate then needs its approval for each asset.
approvals-state-missing = Not reviewed
approvals-state-stale = Stale
approvals-state-refused = Not approved
approvals-state-current = Approved
approvals-verdict-approved = approved
approvals-verdict-changes = changes asked
approvals-verdict-rejected = rejected
approvals-last = Last review: { $verdict } by { $reviewer } on { $date }
approvals-reviewer = Reviewer
approvals-reviewer-needed = Type the name of the reviewer first.
approvals-note = Note
approvals-approve = Approve
approvals-changes = Ask for changes
approvals-reject = Reject

## The release check.

panel-release = Release check
release-panel = Release check
release-run = Run the release check
release-running = The check runs…
release-passed = The release gate lets the { $count } assets through
release-failed = The release gate stops the release: { $errors } errors in { $count } assets
release-findings = Findings of the release gate
release-project = The project
release-level-error = Error
release-level-warning = Warning
release-fix-rights = Open the rights
release-fix-approval = Review
release-fix-asset = Show the asset

## The GLB export.

panel-export = Export
export-panel = Export a scene as GLB
export-scene = Scene
export-out = Output file
export-out-default = .scenity/exports/<scene>.glb
export-imports = Run the importers first
export-run = Export GLB
export-running = The export runs…
export-counts = { $entities } entities, { $models } models
export-valid = The glTF validator finds no error
export-invalid = The glTF validator finds { $count } errors

## The asset sources.

sources = Asset sources
sources-open = Get assets
sources-open-hint = Search a source of free assets (Poly Haven) and import an item with its rights record
sources-provider = Source
sources-kinds = Kinds
sources-kind-environment = Skies
sources-kind-model = Models
sources-kind-texture = Textures
sources-search = Search the source
sources-licence-note = Each item imports with the rights record of its source.
sources-loading = Reads the source…
sources-none = The source has no item for this search.
sources-no-answer = The source does not answer. Check the network, then search again.
sources-import = Import
sources-imported = Imported { $name } with the rights record { $rights }

## The generated assets.

generate = Generate
generate-generator = Generator
generate-kind = Kind
generate-prompt = What to make
generate-estimate = Get the cost
generate-cost = Cost: { $cost } { $unit }, about { $seconds } s
generate-run = Generate
generate-running = Generates…
generate-rights-note = The result imports with the rights record of the generator (kind "generated"): the release gate stops it until the owner reviews the terms.
