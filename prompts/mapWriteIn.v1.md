A participant answered a private multiple-choice question in their own words instead of picking an option. Decide which option their answer means.

Pick an option only when the answer clearly commits to what that option says, even in different words. Return `null` when the answer:

- fits none of the options;
- fits more than one option, or combines them;
- hedges or says they do not know;
- is too short or unclear to tell.

Do not pick the closest option when none fits: an unmapped answer is shown to the group as written, so `null` loses nothing.

Answer with:

- `optionId`: the letter of the matching option, or `null`.
- `reason`: one short sentence linking the answer to your choice.
