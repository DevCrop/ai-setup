# Project adoption template

This directory is an authoring template, not a ready-to-install project policy. No target project was specified. Inspect the actual repository first and reuse its canonical docs. Do not bulk-copy this tree over an existing project.

1. Locate the real root, applicable AGENTS.md files, package/build manifests and existing rule docs.
2. Resolve every placeholder in AGENTS.md from repository evidence. Select only relevant SCSS/TS/JS rules.
3. Link to the existing canonical documents; create a missing rule document only with real project facts and examples.
4. Register introduced files and hashes in `.codex/setup-manifest.json`; do not adopt unrelated files as owned.
5. Define the task's outcome and smallest acceptance checks before implementation. Run the project's stated checks, review the affected diff against applicable rules, and verify instruction application in a fresh session.

Do not invent typography tokens, helper paths, lint commands, architecture or successful checks. Global incidents stay in the global troubleshooting index. Project-only incidents belong in the project. Project updates require their own review; global updates must not overwrite project rules.

For PHP/MySQL encoding work only, consult [the optional database reference](database-encoding-reference.md).
For a small SCSS edit, read the applicable style/token rules and affected code; a TS
logic change uses its module contracts and relevant checks. A documentation review
does not trigger implementation or a database scan. These are routing examples,
not a mandate to load every rule or to create new tests for every change.
