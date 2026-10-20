# SPDX-License-Identifier: Apache-2.0

### The texts of the generic lab core (the top-level files of core/, the lab page). The messages of
### the key help (core/LabHelp.vue) start with lab-help- and are at the end. Camera names, take names, member IDs,
### metric names and numbers are data values. The key names of the help are data values and are not here.

## The time line (LabTimeline.vue). $ms is a step in milliseconds, $time a time of the clock (m:ss.ss).

lab-timeline = Time line
lab-timeline-start = To the start
lab-timeline-back = Step back { $ms } ms
lab-timeline-back-title = Step back (comma; Shift: 250 ms)
lab-timeline-forward = Step forward { $ms } ms
lab-timeline-forward-title = Step forward (period; Shift: 250 ms)
lab-timeline-pause = Pause
lab-timeline-play = Play
lab-timeline-pause-title = Pause (Space)
lab-timeline-play-title = Play (Space)
lab-timeline-sim-time = Simulation time
lab-timeline-take-time = { $time } of the take
# A mark of the track. $label is the event kind with its member or slot (data values), or a named moment.
lab-timeline-mark = { $time } { $label }
# A named moment of the take. $name is the moment name (a data value).
lab-timeline-moment = moment { $name }
lab-timeline-track = Time
lab-timeline-speed = Speed
lab-timeline-loop-from = Loop from here
lab-timeline-loop-from-title = Loop from here ([)
lab-timeline-loop-to = Loop to here
lab-timeline-loop-to-title = Loop to here (])
lab-timeline-clear-loop = Clear the loop
lab-timeline-loop-on = Loop on: clear (\)
lab-timeline-no-loop = No loop
lab-timeline-whole = Whole take
lab-timeline-whole-title = Show the whole take on the time line

## The lab page (Room3DLab.vue). $reason is the failure text of the scene view (English, from a package).

lab-failed = The 3D room failed: { $reason }
lab-retry = Try again
lab-show-panel = Show panel

## The side panel (LabPanel.vue). The plugin gives the labels of its tabs.

lab-panel-help-hint = Read the help for more instructions
lab-panel-help = Keys and controls
lab-panel-hide = Hide panel
lab-panel-tabs = Lab sections
lab-tab-view = View

## The quality tiers (the View tab and the frame statistics).

lab-tier-ultra = Ultra
lab-tier-high = High
lab-tier-medium = Medium
lab-tier-low = Low

## The rows of the frame statistics (useLabStats.ts): the label, the value and the hint of the label. $ms, $update, $pose
## and $render are times in milliseconds with one decimal. $mode is the renderer thread (a data value).

lab-stats-ms = { $ms } ms
lab-stats-none = n/a
lab-stats-frame = Frame p95
lab-stats-frame-hint = The 95th percentile of the time between two frames
lab-stats-cpu = CPU p95
lab-stats-cpu-hint = The 95th percentile of the time to update the scene and send its draw calls
lab-stats-gpu = GPU p95
lab-stats-gpu-hint = The 95th percentile of the GPU time of a frame (timer queries on WebGL, timestamp queries on WebGPU; n/a: the browser has neither)
lab-stats-backend = Backend
lab-stats-backend-hint = The renderer backend that draws, the reason of the choice, and the choice
lab-stats-update = Update (poses) / render
lab-stats-update-value = { $update } ms ({ $pose } ms) / { $render } ms
lab-stats-update-hint = The 95th percentile of the update of the scene, of its part that poses the members (poses, IK, clips) and of the render calls
lab-stats-draws = Draw calls
lab-stats-draws-hint = The draw calls of the last frame, shadows included
lab-stats-triangles = Triangles
lab-stats-triangles-hint = The triangles of the last frame, shadows included
lab-stats-tier = Tier
lab-stats-tier-value = { $tier } · { $mode }
lab-stats-tier-scaled = { $tier } · { $scale }× · { $mode }
lab-stats-tier-hint = The quality tier, the render scale and the renderer thread
lab-stats-memory = Memory
lab-stats-memory-value = { $geometries } geo · { $textures } tex · { $programs } prog
lab-stats-memory-heap = { $geometries } geo · { $textures } tex · { $programs } prog · { $heap } MB
lab-stats-memory-hint = The geometries, the textures and the shader programs of the renderer, and the JS heap of its thread

## The renderer backend (backendText.ts). $backend, $reason and $chosen are data values ("webgpu", "url_override").

lab-backend-text = { $backend } ({ $reason })
lab-backend-text-chosen = { $backend } ({ $reason }; the chooser gave { $chosen })

## The frame rate readout and the card of the frame statistics (LabFrameStats.vue). $gpu is the GPU name of the probe,
## $tier a tier ID and $reason the probe failure (data values).

lab-frame-stats = Frame statistics
lab-fps = { $fps } fps
lab-fps-failures = { $count } asset failures
lab-probe = GPU
lab-probe-hint = The GPU of the capability probe and its result
lab-probe-unknown = unknown
lab-probe-ok = { $gpu } · first tier { $tier }
lab-probe-failed = { $gpu } · { $reason }
lab-asset-failures = Asset failures

## The View tab (LabViewTab.vue). The camera names, the debug layer names and the backend names are data values.

lab-view-camera = Camera
lab-view-camera-reset = Reset camera
lab-view-camera-named = Named camera
lab-view-camera-free = Free view
lab-view-camera-keys = Keys 1 to 9 choose a camera. Drag or swipe on the scene to turn the camera; the wheel or a pinch moves it nearer or farther; W, A, S and D move it over the floor, Q down and E up; the arrow keys turn it in place (Shift: faster).
lab-view-debug = Debug layers
lab-view-tier = Tier
lab-view-backend = Renderer backend
lab-backend-auto = Auto
# The backend text with the adapter of the chooser. $text is the backend text, $adapter the adapter name (a data value).
lab-backend-line = { $text } · { $adapter }
lab-flag-worker = Render worker
lab-flag-reduced = Reduced motion
lab-flag-cards = Member cards
lab-flag-assets = glTF characters

## The Tune tab (LabTuneTab.vue; the tab is hidden). $path is a tune path (a data value).

lab-tune-intro = The numbers of the poses and of the places of the props. A change shows at once; the URL keeps it. Copy the changes into the code when they are right.
lab-tune-search = Search
lab-tune-search-placeholder = Search, for example maskHand or props.cart
lab-tune-copied = Copied
lab-tune-copy = Copy changes ({ $count })
lab-tune-reset-all = Reset all
lab-tune-default = default { $value }
lab-tune-reset = Reset { $path }
lab-nudge = Prop nudge
lab-nudge-prop = Prop to move
lab-nudge-none = No prop
# The place of the prop. $x, $y and $z are metres with three decimals, $turn is degrees with one decimal.
lab-nudge-place = x { $x } · y { $y } · z { $z } · turn { $turn }°
lab-nudge-keys = With a prop selected: Alt and the arrow keys move it 1 cm over the floor, Alt and Q or E move it down or up, Alt and comma or period turn it 1°. Shift: 10 times as much.

## The overview strip of the time line (LabOverview.vue; hidden). $checks is a list of check names (data values).

lab-overview = Overview of the take: { $frames } frames, { $failing } failing times (Enter: the first failing time)
lab-overview-fail = { $seconds } s: { $checks }
lab-overview-stale = stale
lab-overview-stale-title = Frames of the code before the last edit: the indexer draws them again

## The hover preview of the time line (LabIndexPreview.vue). It uses lab-overview-stale for its mark.

lab-preview-stale-title = A frame of the code before the last edit: the indexer draws it again

## The problems of a new camera name and doc line (cameraNames.ts). The camera save form and the lab CLI show them.
## $name is a camera name (a data value), $max a count of characters.

lab-camera-name-length = A camera name has 1 to { $max } characters.
lab-camera-name-bad = "{ $name }" is not a camera name: use small letters and digits, with a hyphen between parts (side-right).
lab-camera-name-fixed = "{ $name }" is the framing of the room kit: give another name.
lab-camera-doc-empty = The doc line of a camera is a short text.
lab-camera-doc-length = The doc line of a camera has at most { $max } characters.
lab-camera-doc-bad = The doc line of a camera has no line break, no */ and none of ; | & $ ` < > \ ".

## The confirm dialog before the first detach of a pane (follow/detach.ts), on the lab page alone.

lab-detach-confirm =
    A detached pane is a second window with its own 3D context and its own copy of the room assets: about 1 GB more memory (measured in the labs app).

    Detach the pane?

## The hidden lab frame of the graph and compare pages (views/shadowLab.ts): the title of its iframe.

lab-shadow-frame = Hidden lab frame

## The key help (LabHelp.vue): the dialog.

lab-help-title = Keys and controls
lab-help-description = The keys work when the focus is not in a field of the panel. The Team tab selects the member of P and K.

## The mouse and touch controls in the key column.

lab-help-control-drag = Drag
lab-help-control-wheel = Wheel
lab-help-control-click = Click
lab-help-control-grip = Grip
lab-help-control-fold = Fold
lab-help-control-place = Place
lab-help-control-drop = Drop

## The rows of the help section "Camera".

lab-help-camera = Camera
lab-help-camera-1 = Move forward and back along the view
lab-help-camera-2 = Move left and right
lab-help-camera-3 = Move down to the floor and up to the ceiling
lab-help-camera-4 = Turn the camera left and right in place
lab-help-camera-5 = Tilt the camera up and down in place
lab-help-camera-6 = Hold with a move or turn key: move or turn faster
lab-help-camera-7 = Mouse or one finger on the scene: turn the camera about what it looks at
lab-help-camera-8 = Scroll or pinch with two fingers: move nearer or farther
lab-help-camera-9 = A named camera (the View tab lists them; 1 is the view of the learner)

## The rows of the help section "Time line".

lab-help-time = Time line
lab-help-time-1 = Play or pause the clock
lab-help-time-2 = Step back or forward 50 ms (Shift: 250 ms)
lab-help-time-3 = Set the start (A) or the end (B) of a loop at the time of the clock
lab-help-time-4 = Clear the loop

## The rows of the help section "Content browser (the dock under the scene)".

lab-help-browser = Content browser (the dock under the scene)
lab-help-browser-1 = Show or hide the browser (the folders, the grid, the inspector); the timeline stays
lab-help-browser-2 = Close or open the whole dock (its header stays)
lab-help-browser-3 = An edge of the dock, of the timeline or of a side panel: resize it (double press: default)
lab-help-browser-4 = Search every item: a clip ID, a word of its text, a status (none) or a priority (P0)
lab-help-browser-5 = A tile or a folder of the tree has the focus: move to the next one
lab-help-browser-6 = Open the tile: a folder shows its items, an item plays its scene in a loop
lab-help-browser-7 = Up one level (Escape too); in the search field Escape clears it

## The rows of the help section "Animations".

lab-help-animations = Animations
lab-help-animations-1 = Replay the animation of the selected member from the start
lab-help-animations-2 = Put the selected member back to idle at its first place
lab-help-animations-3 = A member in the scene: select it (the Team tab)

## The rows of the help section "Props (Tune tab, a prop selected)".

lab-help-props = Props (Tune tab, a prop selected)
lab-help-props-1 = Move the prop 1 cm over the floor (Shift: 10 cm)
lab-help-props-2 = Move the prop down or up 1 cm
lab-help-props-3 = Turn the prop 1° left or right (Shift: 10°)

## The rows of the help section "Scene editor".

lab-help-editor = Scene editor
lab-help-editor-1 = The command palette: search every editor command (Ctrl+P on other systems)
lab-help-editor-2 = An item of the scene (a prop, a device, a member): select it (the card shows it)
lab-help-editor-3 = Clear the selection
lab-help-editor-4 = A selected prop: move it on a 1 cm grid (Shift: 10 cm); Alt at the press lifts it
lab-help-editor-5 = Turn the selected prop 15° (Shift+R: back; Alt+R: 1°)
lab-help-editor-6 = Hold ⌘ at the press: the drag becomes a proposal (a ghost) that you accept or reject on its card
lab-help-editor-7 = Undo an edit (⇧⌘Z: redo); a drag is one step
lab-help-editor-8 = Drag the header of the card to move the cards (arrow keys on it: 20 px; Home or a double click: back)
lab-help-editor-9 = The fold button of the card shows its header only; press it again to open the card

## The rows of the help section "Snap and measure (the scene)".

lab-help-snap = Snap and measure (the scene)
lab-help-snap-1 = A selected prop: it snaps to a top of a prop, a wall, a socket or an anchor near the pointer
lab-help-snap-2 = Hold during a move: no snap (the grid only); Alt at the press lifts the prop
lab-help-snap-3 = Measure: click two points; the distance stays in the frame (M again stops the picks)
lab-help-snap-4 = Stop the picks of a measurement; without a selection, clear the measurements

## The rows of the help section "Team places (the scene)".

lab-help-places = Team places (the scene)
lab-help-places-1 = Show or hide the place rings of the team (they show while a member is selected)
lab-help-places-2 = A member or its ring: move its place to the nearest anchor (a place event; ⌘ at the press: a proposal)

## The rows of the help section "Cables and hand targets (the scene)".

lab-help-cables = Cables and hand targets (the scene)
lab-help-cables-1 = A selected cable: drag a white point (5 mm, Shift 5 cm; Alt at the press: up and down; ⌘: a proposal)
lab-help-cables-2 = A member at work: drag its hand target; the label shows ik.reachError and the contact

## The rows of the help section "Light, timed places, attach (the scene)".

lab-help-light = Light, timed places, attach (the scene)
lab-help-light-1 = The key light handle: drag its dot to turn the light (⌘: a proposal); the Light section of the Tune tab
lab-help-light-2 = Timed place mode: a prop drag places the prop from the clock time on (a take event, a mark on the line)
lab-help-light-3 = A prop dropped on a hand of a member: a prepared Claude change of the held prop (the drag goes back)

## The rows of the help section "Reach and clearance (the scene)".

lab-help-reach = Reach and clearance (the scene)
lab-help-reach-1 = The reach sphere of the selected member; click a prop: 'in reach: 12 cm to spare' (G again hides it)
lab-help-reach-2 = The walk paths of the team with their lengths, a blocked walk red (they also show for 4 s after a move)

## The rows of the help section "Describe and place, onion skin (the scene)".

lab-help-describe = Describe and place, onion skin (the scene)
lab-help-describe-1 = The card of a prop: 'on the cart', 'left of the cart' gives a proposal with its ghost
lab-help-describe-2 = Onion skin: the selected member (else the team) 250 and 500 ms before (blue) and after (orange)

## The rows of the help section "Solo, hide and groups (the scene)".

lab-help-solo = Solo, hide and groups (the scene)
lab-help-solo-1 = Hide the selected items in the focused pane (a view flag: captures show them)
lab-help-solo-2 = Show only the selected items in the focused pane (again: show every item)
lab-help-solo-3 = Show every item again in the focused pane
lab-help-solo-4 = Add an item to the selection, or take it out; a drag moves the selected props
lab-help-solo-5 = Select the named group of the selected prop (a cart with the props on it)

## The rows of the help section "Scene".

lab-help-scene = Scene
lab-help-scene-1 = A tile of the content browser: open a folder, or play an item
lab-help-scene-2 = The frame rate at the top left: show the frame statistics
lab-help-scene-3 = The panel button at the top right: show or hide the panel

## The lab page of a project with no editor plugin (NoPluginPage.vue). The commands and the variable names
## are data values.

lab-no-plugin-title = No editor plugin
lab-no-plugin-body = The project of this editor has no editor plugin. The lab page needs the editor face of a plugin: its takes, its content browser and its commands.
lab-no-plugin-scene = To edit the scenes of the project, open its scene page:
lab-no-plugin-project = To open the lab of a plugin, start the editor on its project with the variable:
# The studio has the Hub, every project and the agents.
lab-no-plugin-studio = To open the Hub with every project, run:
