# SPDX-License-Identifier: Apache-2.0

### The texts of the play control of the scene page: Play, Stop, Keep, Replay,
### Play in a window and the keep list.

## The buttons of the play control in the file bar.

play-start = Play
play-start-title = Play from 0 ms; an edit changes only the play state
play-stop = Stop
play-stop-title = Stop: the edit state comes back
play-keep = Keep
play-keep-title = Choose changes of the play mode to keep
play-replay = Replay
play-replay-title = Play again with the input of the last play (no live input)
play-window-title = Play in a window (the edit view does not change)
play-command-running = The play mode runs.
play-command-stopped = The play mode does not run.
play-command-no-replay = No input of a last play to play again.
play-command-no-clock = The scene has no clock (no sequence).
play-group = Play
play-pause = Pause
play-pause-title = Pause or go on (the clock of the play mode)
play-step = Step
play-step-title = Step one frame forward (the clock stops)
play-time = { $seconds } s

## The keep list: the changes of the play mode.

play-keep-list = Keep:
play-keep-none = No changes in the play mode
play-keep-apply = Keep checked
play-keep-apply-title = Stop and keep the checked changes (one undo step)
play-keep-cancel = Cancel
play-keep-cancel-title = Close the list; the play mode goes on
panel-game-view = Game view
game-camera = Camera
game-camera-first = The first camera
game-resolution = Resolution
game-resolution-free = Free aspect
game-tier = Tier
game-backend = Backend
game-backend-auto = Best backend
game-worker = Worker
game-stats = Stats
game-refresh = Refresh
game-none = The page gives no play view (the browser storage refuses the documents).
game-stats-line = { $fps } fps · { $draws } draw calls · { $triangles } triangles · { $tier } · { $mode }

## The hints and the saved recordings of the play mode (play/playPanels.ts). $name is the name of a recording
## (data); $count is a count of events; $component is a component ID (data); $press is the words of a press.

play-hints = The keys of the game
play-hints-title = Show or hide the keys of the game in the play mode
play-hints-close = Hide the keys of the game
play-hints-arg-show = True shows the keys of the game in the play mode; false hides them.
play-hint-click = Click
play-hint-right-click = Right click
play-hint-on = { $press } on an entity with { $component }
play-recordings = Recordings
play-recordings-title = The saved input recordings of the project
play-recordings-empty = No saved recording.
play-recording-save = Save the last play
play-recording-save-title = Save the input of the last play under a name
play-recording-replay-title = Play again with a saved recording
play-recording-delete = Delete
play-recording-delete-title = Delete a saved recording
play-recording-arg-name = The name of the recording.
play-recording-count = { $count ->
    [one] 1 event
   *[other] { $count } events
}
play-recording-none = No saved recording "{ $name }".
play-recording-full = The browser storage did not keep the recording.
play-recording-arg-view = The view in front during the replay: game (the default) or scene.
