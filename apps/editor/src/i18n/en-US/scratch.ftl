# SPDX-License-Identifier: Apache-2.0

### The texts of the scratch props of the lab page: the scratch part of the selection card, the rights gap and the
### promote (src/core/scratch).

## The scratch part of the selection card (ScratchCard.vue).

scratch-intro = Scratch prop of { $name } (import { $import }): a lab input, not in the learner build.
scratch-loading = loading the model…
scratch-budget =
    { $pass ->
        [yes] { $triangles } triangles, { $kb } KB · in the prop budget
       *[no] { $triangles } triangles, { $kb } KB · OVER the prop budget
    }
scratch-field-source = source
scratch-field-licence = licence
scratch-not-given = not given
scratch-rights = Rights not known: { $gap }. A promote points the asset to the rights record of the imports; the release gate stops it until the owner records its rights.
scratch-duplicate = Duplicate
scratch-delete = Delete

## Promote to the room.

scratch-promote-dry = Promote to the room (dry run)
scratch-promote-dry-title = Ask the host what the promote writes
scratch-promote-blocked = Promote: { $reason }.
scratch-promote-needs-host = the promote needs the workbench host
scratch-promoting = Promoting…
scratch-promote-changes = What the promote writes (no Claude prompt):
scratch-promoted = Promoted: entity { $entity }.
scratch-promote = Promote

## The gap of the rights and the reasons that stop a promote (scratchInfo.ts).

scratch-gap-no-record = no import record
scratch-gap-no-answers = no source and no licence
scratch-gap-no-source = no source
scratch-gap-no-licence = no licence
scratch-gap-not-checked = not checked against the licence register: import the file again
scratch-gap-not-allowed = the licence register does not allow the source
scratch-block-budget = the model is not in the budget

## The models of the scratch props (scratchModels.ts).

scratch-model-none = no model
scratch-model-needs-host = the models of scratch props come from the workbench host
scratch-model-timeout = no model in { $seconds } s
