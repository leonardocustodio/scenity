# SPDX-License-Identifier: Apache-2.0

### The texts of the sequence tab of the scene page (scene/sequencer/; scene docks). Entity names and IDs,
### track names and kinds, property paths, marker names and times are data values. $ms is a step in milliseconds, and
### $time is a time of the sequence in seconds (for example 1.25 s).

## The play bar (SequencerPanel.vue).

sequencer-panel = Sequencer
sequencer-timeline = Time line
sequencer-start = To the start
sequencer-back = Step back { $ms } ms
sequencer-back-title = Step back (comma; Shift: 250 ms)
sequencer-forward = Step forward { $ms } ms
sequencer-forward-title = Step forward (period; Shift: 250 ms)
sequencer-pause = Pause
sequencer-play = Play
sequencer-pause-title = Pause (Space)
sequencer-play-title = Play (Space)
sequencer-loop-from-title = Loop from here ([)
sequencer-loop-to-title = Loop to here (])
sequencer-loop-clear = Clear the loop
sequencer-loop-on-title = Loop on: clear (\)
sequencer-loop-off-title = No loop
sequencer-record = Record
sequencer-record-title = Record: an edit at the time now becomes a key

## The form of a new track or marker.

sequencer-track-kind = Kind of the new track
sequencer-track-entity = Entity of the new track
sequencer-track-selected = (selected entity)
sequencer-track-path = Path of the property
sequencer-add-track = Add track
sequencer-marker-sample = marker name
sequencer-marker-name = Name of the new marker
sequencer-add-marker = Add marker

## The track list and the time ruler (SequencerTracks.vue). $name is a marker name, $track the label of a track.

sequencer-tracks = Tracks
sequencer-group-sequence = Sequence
sequencer-marker-title = { $name } at { $time }
sequencer-key-add = Add a key at the time now
sequencer-track-remove = Remove the track
sequencer-key-title = { $track } at { $time }
sequencer-key-proposed = proposed by { $name }
sequencer-key = Key at { $time }
sequencer-empty = No track yet. Add a track, or turn on Record and move an entity.

## The curve editor (SequencerCurve.vue). $min, $max and $value are numbers of the keys, $line the label of a line.

sequencer-curve-range = { $min } to { $max }
sequencer-curve-point = { $line } { $value } at { $time }
# The line of one axis of the position of a transform track. $axis is x, y or z.
sequencer-curve-position = position { $axis }

## The page commands of the key map (useSequencer.ts). The palette and the key settings show them.

sequencer-command-toggle = Play or pause the sequence
sequencer-command-loop-from = Loop from the time now (A)
sequencer-command-loop-to = Loop to the time now (B)
sequencer-command-delete-key = Delete the selected key

## The clock in the main toolbar (sequencer/clockBar.ts). $speed is a number; $from and $to are seconds.

clock-group = Clock
clock-time = The time of the clock (seconds)
clock-time-title = Type a time in seconds, then Enter
clock-speed = The speed of the clock
clock-speed-value = { $speed }×
clock-loop-range = Loop { $from } s to { $to } s
clock-command-seek = Go to a time of the clock
clock-command-speed = Set the speed of the clock
clock-arg-ms = The time (ms from the start of the sequence).
clock-arg-speed = The speed: clock ms for each ms (0.25, 0.5, 1, 2 or 4).
clock-play-mode = In the play mode the clock keys go to the game.

## The zoom of the time line.

sequencer-zoom-in = Zoom in (⌘ or Ctrl and the wheel)
sequencer-zoom-out = Zoom out
sequencer-zoom-fit = Show the whole time line
sequencer-zoom-fit-short = Fit

## The head of the Timeline and the form of a key. $field is a field name of a key (data).

sequencer-head = The sequence
sequencer-picker = The sequence to edit
sequencer-new = New sequence
sequencer-duration = Duration
sequencer-seconds = s
sequencer-loop = Loop
sequencer-initial = Initial state
sequencer-initial-apply = Apply the initial state
sequencer-key-form = The selected key
sequencer-key-time = Time (ms)
sequencer-key-ease = Ease
sequencer-key-apply = Apply
sequencer-key-json = The field { $field } is not JSON.

## The curve editor v2.

sequencer-curve-all = All curves
sequencer-curve-frame = Frame all
sequencer-curve-ease = Ease
sequencer-ease-step = Step
sequencer-ease-linear = Linear
sequencer-ease-in = In
sequencer-ease-out = Out
sequencer-ease-inOut = In and out
sequencer-ease-bezier = Bézier

## The proposals of the agents in the Timeline. $count is a count of proposals.

sequencer-proposals = { $count ->
    [one] 1 change of an agent waits (the dashed keys)
   *[other] { $count } changes of an agent wait (the dashed keys)
}
sequencer-accept-all = Accept
sequencer-reject-all = Reject

## The Simulation panel. $seconds is a time.

panel-simulation = Simulation
simulation-time = At { $seconds } s
simulation-none = No simulation runs at this time (no sequence, or no simulation plugin).
simulation-id = ID
simulation-stream = Recorded stream
simulation-stream-none = No stream
simulation-live-none = The page has no live source (an engine that sends its states).

## The Animator window. $name is the name of a state, a parameter or a layer (data).

panel-animator = Animator
animator-no-layer = The animator has no such layer.
animator-no-state = The layer has no state { $name }.
animator-state-exists = The layer has a state { $name } already.
animator-state-start = The state { $name } is the start of the layer: choose another start first.
animator-state-used = A transition names the state { $name }: remove the transition first.
animator-parameter-exists = The animator has a parameter { $name } already.
animator-parameter-used = A condition or a blend names the parameter { $name }.
animator-layer-exists = The animator has a layer { $name } already.
animator-none = No entity of the scene has an animator.
animator-entity = The entity of the animator
animator-parameters = Parameters
animator-preview = The value of { $name } now (the view shows it)
animator-new-parameter = The name of a new parameter
animator-parameter-type = The type of the new parameter
animator-add = Add
animator-layer = Layer
animator-states = The states of the layer
animator-start = { $name } is the start state
animator-new-state = New state
animator-clip = The clip of the new state
animator-transitions = Transitions
animator-conditions = The conditions as JSON, for example [{"{"}"parameter": "speed", "op": "gt", "value": 0.1{"}"}]
animator-conditions-json = The conditions are a JSON list.
animator-any = Any state
animator-from = From
animator-to = To
animator-type-number = Number
animator-type-bool = Flag

## The Character setup window. $bones is a list of bone names; $bone is a bone name (data). $goal is the name of an
## IK goal; $name is an entity name (data).

panel-character = Character setup
character-none = Select an entity with a skinned model.
character-rig = Rig profile
character-rig-none = None
character-detect = Detect
character-missing = Missing bones: { $bones }
character-complete = Each required bone has a node.
character-bones = The bone map
character-node = The node of { $bone }
character-node-profile = The node of the profile
character-clip-source = Clip source
character-clip-own = The clips of the model
character-variant = Look variant
character-variant-none = None
character-ik-handles = Move the IK targets in the view
character-ik-handles-title = A handle at each IK target entity of the character: drag it in the Scene view to move the target
character-ik-handle = The IK target of { $goal }: { $name }
character-ik-left-hand = Left hand
character-ik-right-hand = Right hand
character-ik-look = Look
character-ik-none = No IK goal has a target entity. Set the targets in the IK goals of the Character component.
character-retarget = Retarget preview
character-retarget-clip = The clip of the retarget preview
character-retarget-title = Play the clip of the clip source on the character in the Scene view (an open sequence)

## The clip browser. $name is an entity name and $clip a clip name (data).

panel-clips = Clips
clips-none = Select an entity with a model.
clips-empty = The model of { $name } has no clips.
clips-no-sequence = Open a sequence: a clip goes on the timeline as an animation key and plays in the view.
clips-list = The clips of { $name }
clips-drag = Drag the clip onto the timeline to add an animation key
clips-from-source = Clip source
clips-preview = Preview
clips-preview-stop = Stop
clips-preview-name = Preview { $clip } in the view
clips-add = Add at the playhead
clips-add-name = Add { $clip } at the playhead
