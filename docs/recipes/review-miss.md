# Turn a review miss into a check

**Situation.** A bug shipped that your review skill should have caught. You want proof it catches that
kind of bug from now on, and a warning if a later edit to the skill makes it miss again.

**Level 3.**

1. Write the smallest patch that reintroduces the bug, as `evals/<suite>/cases/<id>/seed.patch`.
2. Describe it in `case.json`: the rule broken, the file, and the words a correct review must use:

   ```json
   { "id": "unpaid-invoice-hidden", "rule": "Unpaid invoices stay visible to the account owner",
     "mustName": ["unpaid", "visible"], "file": "src/invoices/list.ts",
     "branch": "fix/invoice-filter", "message": "Tidy invoice filter", "expect": "review" }
   ```

3. Check the seed applies, then run the suite:

   ```bash
   node scripts/tbs/skill-eval.mjs routine --dry-run
   node scripts/tbs/skill-eval.mjs routine
   ```

**Working looks like.** The review runs blind (it never sees the case files or the record), the judge
quotes a line of the review that names the file and a required term, and the case passes on every
repeat. `node scripts/tbs/skill-eval.mjs --check` stays green until someone edits the skill; then it
reports the record as stale and the lane gate drops to one lane until the suite is re-run.

If the bug is better stopped by code than by review, prefer a stronger check (a type, a lint rule
with the fix in its message, a test) and record it in `docs/trust-before-scale/enforcers.md`.
