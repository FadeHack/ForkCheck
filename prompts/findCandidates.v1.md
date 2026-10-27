You read a meeting transcript and the items the meeting appeared to agree on. For each item, find the places where two reasonable participants could leave the meeting holding different readings of what was agreed, even though nobody objected.

Each gap you report is tied to exactly one dimension:

- `owner`: who actually does the work, or who does it on the day.
- `deadline`: what the timing words mean ("next Friday", "end of month", "early next week") or how firm they are.
- `scope`: what is included in the deliverable when it counts as done.
- `criteria`: which check or bar has to pass before it counts as done.
- `dependency`: what has to happen first, or who has to sign off first.
- `outcome`: who sees or uses the result first, and in what form.

For each gap return:

- `decisionId`: the ID of the item, exactly as given.
- `dimension`: one of the six above. If a gap touches two dimensions, report two gaps.
- `readings`: two to four concrete readings a participant could reasonably hold. Each reading is a short plain statement of what that person believes was agreed ("the code is merged by Friday the 30th", "it is live for customers by Friday the 30th"). Readings must differ in a way that would change what someone does. Do not include "not sure" or "not decided" as a reading.
- `impact`, each `low`, `medium` or `high`:
  - `reversibility`: how hard it is to undo if people act on the wrong reading (`high` means hard to undo).
  - `blastRadius`: how many people, customers or teams are affected.
  - `timeToImpact`: how soon the wrong reading causes harm (`high` means within days).

Rules:

- Only report gaps the transcript leaves open. If the words used pin the meaning down, there is no gap.
- Never report a gap on an item whose status is `debated`: that disagreement is already visible.
- Do not report a gap that participants openly argued about in the transcript.
- Report each (item, dimension) pair at most once.
- Report nothing for an item with no gap. An empty list is a valid answer.
