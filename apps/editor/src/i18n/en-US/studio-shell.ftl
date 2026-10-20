# SPDX-License-Identifier: Apache-2.0

### The texts of the editor window of Scenity Studio (src/studio/shell).

## The panels (the registry, src/studio/shell/panels.ts).

panel-scene-view = Scene
panel-inspector = Inspector
panel-hierarchy = Hierarchy
panel-project = Project
panel-timeline = Timeline
panel-rules = Rules
panel-material = Material
panel-lighting = Lighting
panel-project-settings = Project settings
panel-shortcuts = Shortcuts
panel-vcs = Version control
panel-jobs = Jobs
panel-plugins = Plugins
panel-budgets = Budgets
panel-preferences = Preferences
panel-loading = Loading…
panel-unknown = This panel is not available in this project.
# $title is the title of the panel; $copy is the number of the copy (2 or more).
panel-copy = { $title } { $copy }
# $title is the title of the panel.
panel-open = Open the panel { $title }
panel-close = Close { $title }

## The Window menu and the commands of the dock.

menu-window = Window
window-maximize = Maximize the panel
window-float = Float or dock the panel
window-copy = New copy of the panel
window-move-left = Move the panel to the left
window-move-centre = Move the panel to the centre
window-move-right = Move the panel to the right
window-move-bottom = Move the panel to the bottom
window-close = Close the panel
window-next = Next panel
window-previous = Previous panel
window-reset = Reset the layout
panel-none = No panel is active.
panel-no-copy = The active panel cannot have copies.
layout-not-custom = Only a workspace of yours can change its name or go.
workspace-switch = Show a workspace
workspace-arg-id = The ID of the workspace, for example layout or animate.
workspace-arg-name = The name of the workspace (none: ask the person).

## The workspaces and the Layout menu.

workspace-label = Workspaces
workspace-layout = Layout
workspace-animate = Animate
workspace-assets = Assets
workspace-review = Review
workspace-build = Build
layout-menu = Layout
layout-save-as = Save as…
layout-rename = Rename…
layout-delete = Delete
layout-reset = Reset
layout-save-title = Save the layout as a workspace
layout-rename-title = Rename the workspace
layout-name = Name
layout-name-save = Save
layout-cancel = Cancel

## The dialogs, the toasts and the banners of the window.

notice-dismiss = Dismiss
# $path is the path of the scene file.
notice-saved = Saved { $path }
notice-playing = Playing: the edits of the play mode are not saved.
notice-restricted = Restricted mode: the plugins of this project do not run until you trust it.
notice-viewer = View only: you look at this project and leave notes. A change needs a link with the editor role from the owner.
notice-viewer-locked = A viewer changes nothing: ask the owner of the studio for a link with the editor role.
notice-restricted-owner = Restricted mode: the plugins of this project do not run until the owner of the studio trusts it.
role-owner-only = Only the owner of the studio does this, not an editor or a viewer.
role-remote-shell = The studio in remote mode opens no shell. Use the Claude terminal.
role-editor-auto = An editor chooses Ask or Review. Only the owner of the studio chooses Auto.
role-remote-files = Remote mode: each file write of an agent asks, in the Auto mode too.
notice-trust = Trust this project…
notice-trust-title = Trust this project?
# $name is the name of the project.
notice-trust-text = The plugins of { $name } run code on this machine. Trust it only when you know where it comes from.
notice-trust-yes = Trust and reload
notice-trust-no = Not now

## The status bar.

status-label = Status
status-save-title = The state of the scene file (a press saves)
status-selection =
    { $count ->
        [0] Nothing selected
       *[other] { $count } selected
    }
status-selection-title = The selection (a press frames it)
# $count is the number of jobs that run.
status-jobs = { $count ->
    [one] 1 job
   *[other] { $count } jobs
}
status-problems-title = The failed rules and warnings (a press opens the Problems panel)
status-render-title = The backend, the tier and the frame rate (a press opens the inspect panel)
# $fps is the number of frames per second.
status-fps = { $fps } fps
# $count is the number of facts that need an action.
status-bell = Notifications: { $count }
status-bell-empty = Nothing needs an action.

## The rails of a small window.

fold-left = Left panels
fold-right = Right panels

## The menu bar.

menu-bar = Menu bar
menu-file = File
menu-edit = Edit
menu-assets = Assets
menu-entity = Entity
menu-component = Component
menu-sequence = Sequence
menu-agent = Agent
menu-build = Build
menu-help = Help
menu-window-theme = Theme
menu-window-split = Split view
menu-sequence-loop = Loop range
menu-entity-create = Create
menu-entity-place = Place
menu-agent-recipes = Recipes
menu-edit-camera = Editor camera
menu-edit-selectBy = Select by
# The short labels of the commands in the menus (else the menu shows the title of the command).
menu-item-file-save = Save
menu-item-history-undo = Undo
menu-item-history-redo = Redo
menu-item-entity-copy = Copy
menu-item-entity-paste = Paste
menu-item-entity-duplicate = Duplicate
menu-item-entity-delete = Delete
menu-item-entity-rename = Rename
menu-item-view-frame = Frame
menu-item-play-start = Play
menu-item-play-replay = Replay
menu-item-play-stop = Stop
menu-item-entity-add = Create empty
menu-item-entity-hide = Hide or show
menu-item-entity-solo = Solo
menu-item-view-show-all = Show all
menu-item-entity-lock = Lock
menu-item-sequence-track-add = Add a track
menu-item-sequence-key-add = Add a key
menu-item-sequence-marker-add = Add a marker
menu-item-clock-toggle = Play or pause
menu-item-panel-open-preferences = Preferences
menu-item-theme-dark = Dark
menu-item-theme-light = Light
menu-item-theme-navy = Navy
menu-item-theme-contrast = High contrast

## Search and ask.

search-label = Search and ask
search-placeholder = Search commands, entities, assets, files, settings and docs (> @ # ?)
search-results = Results
search-docs = The docs of { $label } (F1)
search-empty = No result.
search-ask = Ask the agent: “{ $text }”
search-ask-none = No agent is connected: the agent panel (⌘L) says how to connect one.
search-kind-agent = Agent
search-kind-commands = Commands
search-kind-entities = Entities
search-kind-assets = Assets
search-kind-files = Files
search-kind-settings = Settings
search-kind-docs = Docs
search-command-open = Search and ask
search-command-scene = Search the entities of the scene
search-command-window = Open the Search window

## The Search window. $count is a number of entities; $text is a saved search; $field is a field path and
## $entity the name of an entity.

panel-search = Search
search-window-label = Search the project
search-window-placeholder = c:light intensity>2, t:model, tag:wood, > commands, # assets
search-window-kind = Kind of results
search-window-all = All kinds
search-window-save = Save
search-window-saved = Saved searches
search-window-remove = Remove the saved search “{ $text }”
search-window-hint = Type a search. A comparison such as intensity>2 adds a column that you can edit.
search-window-entities =
    { $count ->
        [one] One entity
       *[other] { $count } entities
    }
search-window-select-all = Select all
search-window-name = Name
search-window-components = Components
search-window-cell = { $field } of { $entity }

## The key sheet and the help commands.

keys-title = Keys
keys-filter = Filter the keys
keys-kind-held = hold
keys-kind-modal = in a drag
keys-context-global = Everywhere
keys-context-scene = Scene view and side panels
keys-context-hierarchy = Hierarchy
keys-context-dock = Bottom panels
keys-context-sequencer = Timeline
keys-context-fly = Fly (the right button is down)
keys-context-drag = A gizmo drag
help-command-keys = Show the key sheet
help-command-tour = Take the tour
help-command-context = Help for the active panel
menu-item-help-keys = Keys
menu-item-help-context = Help for this

## The activity log.

panel-activity = Activity
activity-lines = The runs of the commands, the newest first
activity-empty = No command ran yet.
activity-person = You
activity-agent = Agent
activity-script = Script
activity-plugin = Plugin
activity-outcome-applied = applied
activity-outcome-proposed = waits for you
activity-outcome-unchanged = no change
activity-outcome-ran = ran
activity-copy-script = Copy as a script call
activity-copy-prompt = Copy as a prompt
activity-prompt-batch = Run these editor commands as one step “{ $title }”: { $steps }.
activity-prompt-command = Run the editor command { $command } with { $args } ({ $title }).

panel-history = History
history-steps = The steps of the history
history-start = The scene as it opened
history-person = You
history-actor-agent = An agent
history-actor-script = A script
history-actor-plugin = A plugin
history-turn = { $name }: turn { $turn }
command-history-go-to = Go to a step of the history
history-go-to-none = No step { $step } to go to.
history-group = History
history-undo-step = Undo { $step }
history-redo-step = Redo { $step }
history-undo-none = Nothing to undo
history-redo-none = Nothing to redo
panel-console = Console
console-source = Source
console-source-all = All sources
console-source-page = Page
console-source-worker = Worker
console-source-server = Server
console-source-host = Host
console-source-plugin = Plugin
console-source-job = Job
console-source-agent = Agent
console-search = Search the log
console-clear = Clear
console-lines = The lines of the log
console-empty = No line.
console-detail = The line
console-detail-facts = { $source } · { $count ->
    [one] once
   *[other] { $count } times
}
console-level-error = { $count } errors
console-level-warn = { $count } warnings
console-level-info = { $count } messages
console-level-name-error = Error
console-level-name-warn = Warning
console-level-name-info = Message
console-server-error = The dev server gave an error.
console-job-failed = { $line } failed (exit { $code })
console-rejection = Unhandled rejection: { $reason }
