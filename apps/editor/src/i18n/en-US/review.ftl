# SPDX-License-Identifier: Apache-2.0
# The Review panel.
panel-review = Review
review-empty = No change waits for review.
review-turn = turn { $turn }
review-preview = Preview
review-check-run = Check
review-checking = Checking…
review-rules-pass = The rules pass
review-rules-fail = A rule fails
review-before = Before
review-after = After
review-diff = The diff of the set
review-changes = The changes of the set
review-document = The scene
review-check-entity = Choose the changes of { $name }
review-check-op = Choose the change of { $field }
review-change-added = added
review-change-removed = removed
review-change-changed = changed
review-change-moved = moved
review-accept-entity = Accept the changes of { $name }
review-reject-entity = Reject the changes of { $name }
review-accept-op = Accept this change
review-reject-op = Reject this change
review-reject-all = Reject all
review-accept-checked = Accept { $count } checked
review-accept-all = Accept all
review-status = { $count ->
    [one] 1 change waits
   *[other] { $count } changes wait
}
review-feedback = Turn { $turn }: the person accepted { $accepted } of { $total } changes.
review-feedback-rejected = { " " }Rejected: { $list }.
review-mark = { $by } changed this
review-mark-field = { $by } proposes { $after } (now { $before }); it waits for review
review-stale = ⚠ gone
review-conflict = ⚠ you changed it
review-conflict-title = You changed this value after the agent. Your value stays unless you accept the change of the agent.
review-undo-turn = Undo the turn { $turn } of { $name }
review-undo-no-inverse = A step of the turn has no inverse.
review-no-checkpoint = This window has no checkpoint of that turn.
review-restore = Restore the checkpoint of turn { $turn }
review-change-working = in progress
