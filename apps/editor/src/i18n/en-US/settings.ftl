# SPDX-License-Identifier: Apache-2.0

### The texts of the settings of the scene page (scene/settings). The labels of the settings and
### the reasons of a refused value come from @scenity/editor-core and stay in English.

## The settings tab of the bottom dock (settingsTab.ts, SettingsPanel.vue).

settings-tab = Settings
settings-panel = Settings
settings-editor = Editor settings
# $file is the path of the settings file of the project.
settings-intro = Project values go to { $file }; the other values stay in this browser.

## The source of the value of a setting, the scope of a setting and the reset button.

settings-source-project = project file
settings-source-user = this browser
settings-source-default = default
settings-scope-project = Scope: the project file wins
settings-scope-user = Scope: this browser wins
settings-reset-value = Back to the default

## The layout of the project.

settings-layout = The layout of the editor window
settings-layout-left = Hierarchy panel
settings-layout-right = Inspector panel
settings-layout-reset = Reset the layout
settings-resize-title = Drag to change the size; double-click to open or close

## The key map. $id is the ID of a command, and $commands is a list of command IDs.

settings-keys = Keys
settings-keys-search = Search a command
settings-keys-capture = Press the new key of { $id } (Escape: cancel).
settings-keys-clash = The key of { $id } is also the key of { $commands }.
settings-keys-none = no key
settings-keys-change = Change
settings-keys-add = Add
settings-keys-clear = Clear
settings-keys-reset = Reset

## The page commands of the file bar (startEditorSettings.ts).

settings-command-save = Save the scene
settings-command-undo = Undo
settings-command-redo = Redo
settings-command-play = Start or stop the play mode

## The reasons why the page cannot write the settings file. $file is the path of the file.

settings-refuse-no-file = The page has no project file to write.
settings-refuse-changed = { $file } changed on the disk.

## The labels of the setting fields of @scenity/editor-core (SETTING_FIELDS), by the path of the field.

settings-field-title = Setting { $path }
settings-field-snaps-grid = Grid snap
settings-field-snaps-angle-degrees = Angle snap
settings-field-snaps-scale = Scale snap
settings-field-view-mode = View mode
settings-field-view-grid = Grid
settings-field-camera-fly-speed = Fly speed
settings-field-camera-fly-fast-speed = Fly speed (Shift)
settings-field-camera-look-speed = Turn speed
settings-field-camera-look-fast-speed = Turn speed (Shift)
settings-field-camera-orbit-speed = Orbit speed
settings-field-camera-zoom-speed = Zoom speed
settings-field-dock-tab = Default bottom panel
settings-field-dock-height = Default bottom height
settings-field-layout-workspace = Default workspace
settings-field-recent-count = Recent scenes

## The titles of the commands of @scenity/editor-core in the key map, by the ID of the command.

settings-command-entity-duplicate = Duplicate the entities
settings-command-entity-delete = Delete the entities (with their children)
settings-command-entity-copy = Copy the entities (with their children)
settings-command-entity-paste = Paste the entities of the clipboard
settings-command-entity-hide = Hide or show the entities
settings-command-entity-solo = Solo the entities
settings-command-view-show-all = Show all entities (no solo)
# $id is the ID of a command.
settings-command-none = No command { $id }.
settings-keys-fixed = Fixed (a key of one gesture)

## The theme of the editor window.

settings-theme = Theme
settings-theme-name = Theme
settings-theme-dark = Dark
settings-theme-light = Light
settings-theme-navy = Navy
settings-contrast = High contrast
# The commands of the theme (the search box and the key map).
theme-use = Use the { $name } theme
theme-contrast = Turn the high contrast on or off
settings-field-render-tier = Quality tier (at the next open)
settings-field-render-backend = Backend (at the next open)
settings-field-render-worker = Render worker (at the next open)
settings-field-render-gpu-timer = GPU timer (at the next open)
settings-field-render-assets = Assets: the build, the sources or both (at the next open)
settings-field-render-audio = Audio (at the next open)
settings-field-autosave-enabled = Autosave the open scene
settings-field-autosave-seconds = Autosave after (no edit for this time)

## The scene pool in Preferences → Advanced.

settings-advanced = Advanced
pool = Scene pool
pool-hint = A pool of warm browser pages for the shot, sheet and clip commands. The pool runs until you stop it.
pool-no-server = The pool controls need the dev server.
pool-running = The pool runs: { $pages } pages, { $warm } warm, { $leases } leases.
pool-starting = The pool starts…
pool-stopped = The pool does not run.
pool-pages = Pages
pool-start = Start
pool-stop = Stop
pool-refresh = Refresh

## The search, the groups of the settings and the preferences of the studio host.

settings-search = Search the preferences
settings-group-snaps = Snaps
settings-group-view = View
settings-group-camera = Camera
settings-group-dock = Dock
settings-group-layout = Workspace
settings-group-recent = Recent
settings-group-render = Render (at the next open)
settings-group-autosave = Autosave of the project
settings-host = Studio
settings-host-none = The studio host keeps the language, autosave and the agent defaults. Open the editor from the studio to change them.
settings-autosave = Autosave
settings-agent-model = Agent model
settings-agent-effort = Agent effort
settings-host-failed = The studio host did not take the change.

## The usage log of a usability study.

settings-group-usage = Usage
settings-group-notes = Notes
settings-field-notes-author = Your name in notes (the team sees it on your notes and replies)
settings-field-usage-log = Usage log (for a usability study; it stays in this browser)
usage-title = Usage log
usage-hint = With the setting "Usage log" on, the editor keeps a line for each command in this browser. Nothing leaves the machine; download the log for a study.
usage-count = { $count } lines
usage-download = Download
usage-clear = Clear
