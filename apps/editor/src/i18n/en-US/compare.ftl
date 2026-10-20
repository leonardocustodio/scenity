# SPDX-License-Identifier: Apache-2.0

### The texts of the compare view of the lab core (core/compare).

## The controls of the compare view (ComparePage.vue). The take and camera names are data values.

compare-title = Compare
compare-side = Side { $side }
compare-code = Code
compare-code-now = now
compare-code-hash = { $hash } (index)
compare-camera = Camera
compare-view = View
compare-mode-side = Side by side
compare-mode-wipe = Wipe (W)
compare-play = Play both
compare-pause = Pause both
compare-play-title = Play both (Space)
compare-pause-title = Pause both (Space)
compare-time = The time of both sides
compare-drawing = Drawing…
# The source of the frame of each side and the time to get it.
compare-status = A: { $aFrom ->
        [index] index { $aMs } ms
        [render] render { $aMs } ms
        [none] none { $aMs } ms
       *[empty] —
    } · B: { $bFrom ->
        [index] index { $bMs } ms
        [render] render { $bMs } ms
        [none] none { $bMs } ms
       *[empty] —
    }

## The two pictures (CompareStage.vue, sources.ts).

compare-no-take = no take
compare-frame-alt = { $label } at { $time }
compare-frame-loads = The frame loads.
compare-alt-a = A: { $label }
compare-alt-b = B: { $label }
compare-wipe-a = A { $label } { $time }
compare-wipe-b = B { $label } { $time }
compare-split = The line of the wipe: the share of A

## The notes of a frame (compareFrames.ts).

compare-no-frame-no-lab = No frame and no lab.
compare-no-older-frame = The index has no frame of this content hash and camera.
compare-nearest-frame = The nearest frame: { $seconds } s.
