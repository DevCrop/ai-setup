# Release verification

Current release: [v1.2 verification](verification-v1.2.md). Earlier [v1.1 evidence](verification-v1.1.md) remains historical. The following is historical v1.0.1 evidence.

Date: 2026-09-14. This is configuration validation, not a model-efficiency benchmark.

- v1.0.1 Windows/Python 3.14 local: 27 lifecycle/monitor tests, 26 passed and one symlink-creation test skipped because the host denied symlink creation. Windows junction refusal was exercised separately and passed.
- Covered: first install/adoption, idempotency, obsolete-file deletion, config preservation, modified-file conflicts, rollback, simulated write failure, interrupted recovery, path traversal, multiline TOML refusal, and removal of retired config keys.
- Repository validation: JSON/TOML/UTF-8, 222 manifest files, 38 reference records and two pinned upstream packages passed. Config keys make 223 deployed managed files in total.
- Actual global application: 11 changes (including two fingerprint-matched old backup removals); subsequent verify passed and second apply was unchanged.
- v1.0.1 application updated the installed version with zero policy-file changes; managed-file verification passed with no conflicts. The cleanup fixes are in the setup tooling, not an expansion of routine global instructions.
- Codex CLI 0.147.0 debug prompt rendering: global agreement, current project instructions, Archify and Ponytail all present. No model calls. This is not an app UI check or proof of model compliance.
- `--strict-config` cannot be combined with this CLI's debug command; that attempted check was unsupported, not passed. Ordinary debug prompt/catalog loading succeeded.
- Archify global diagram: schema/showcase validation 9/9; browser containment checked at four sizes. See the portable diagram receipt.
- v1.0.1 GitHub CI [run 34856748073](https://github.com/DevCrop/codex-setup/actions/runs/34856748073), code commit 7bf2ed1: all six native Windows/macOS/Linux × Python 3.11/3.14 jobs passed, running 27 cases with platform-specific skips and the expanded integrity checks. The subsequent release commit only records these results and document links. CI does not establish a real product workflow or an actual separate-drive Windows installation.
- The first macOS run revealed system /var symlink rejection; only verified macOS system aliases were permitted, then all six jobs passed. Arbitrary symlinks and Windows junctions remain refused.
- No actual product project selected: project-specific SCSS/TS behavior and project flow remain pending project onboarding.
- No login credentials copied, API model calls, model benchmark, or measured subscription saving claim.
- Source monitoring: initial 12 endpoints fetched successfully; blog discovery subsequently added. Weekly automation `trace` registered for Monday 10:00 local time on this host only, with candidate approval required.
- Closure monitoring check: all 13 endpoints fetched successfully. The improved main/article extractor produced 12 hash candidates and one unchanged source; these are not assertions of 12 substantive upstream policy changes. No candidates were automatically applied.
- Active AGENTS.md is 4,334 bytes. No instruction-token or subscription saving has been established; the release adds portability and ownership requirements while avoiding routine full-source loading.

Open the app's Personalization settings and compare with the deployed global AGENTS.md in a fresh task. The documented relationship is not a claim that the UI was inspected in this run.
