# Mixed tools

**Situation.** You use more than one agent tool, for example Claude Code to write, Codex to review, and
Gemini as the eval judge, and want each to check the others.

**Level 3.** Install the kit in each host ([harnesses](../harnesses.md)). They share one project config,
`.agents/trust-before-scale.json`, and one merge-gate script.

Choose who reviews and who judges per eval suite:

```json
"evals": { "suites": [ {
  "name": "routine", "skills": [".agents/skills/routine"],
  "reviewPrompt": "Use the routine skill to review {branch}",
  "reviewer": "codex", "judge": "gemini"
} ] }
```

Presets are `claude`, `codex`, `cursor-agent` and `gemini`; anything else is a command template with
`{prompt}` and optionally `{branch}`. A judge that matches the reviewer is refused unless the suite sets
`allowSameJudge: true`. In the routine, the cross-review uses a different model from the author's.

**Working looks like.** `doctor.mjs` finds every configured CLI, and the evidence block names the
actual model behind each pass.
