# Operations

For browser/native UI capability checks, installed SDK ownership, sanitized failure
records and narrowly scoped home cleanup, follow
[Computer Use maintenance](computer-use-maintenance.md). Dependency cleanup needs
its own per-project approval (see below).

Start from the repository README and installer help for executable commands. Resolve paths from the script location, explicit root and supported user directories; never assume a drive letter or current shell directory. Honor CODEX_HOME. Authenticate separately on each host with the installed CLI's supported ChatGPT login flow; do not copy auth files into this repository.

## Managed lifecycle

Run plan before apply. Inspect additions, changes, removals and conflicts. Apply only approved owned files; preserve user edits, permissions, model selection, MCP secrets and unrelated settings. Verify after apply. Keep one previous managed state in the local state directory for rollback, not backup copies in active paths. On failure restore that state and report conflicts. Installer-owned temporary artifacts are cleaned after success; application caches, sessions and credentials are not general cleanup targets.

## Profiles and fresh sessions

The optional CLI profiles are `sol`, `astra` and `astra-deep`. They are separate `.config.toml` files selected with `--profile`. Check host model support; the app composer remains user-controlled. A parsed configuration is not proof of a fresh session's effective instruction or model behavior. Inspect new-session loading separately. Legacy overrides and project trust can affect effective configuration.

## Implementation contract

The global agreement owns the general decision rules; projects own their concrete
commands and conventions. Before implementing, derive the intended outcome, allowed
scope and smallest acceptance checks from the request and relevant project guidance.
Straightforward work does not need a separate plan file or routine approval pause.
Ask only when an unresolved decision materially affects the authorized outcome.

After relevant checks, review the affected diff for requested behavior, applicable
project rules and unrelated edits. Passing tests alone does not establish style,
helper or architecture compliance. Reuse existing lint/type/contract checks where
they cover a rule; inspect the changed code where no executable check exists.
Stop once the stated acceptance criteria are met; do not broaden verification
without a changed scope, new failure or unresolved concern.

When a failure repeats, identify whether code, tooling/environment, permissions or
requirements caused it. Retry with new evidence or a changed hypothesis; preserve
acceptance checks and report a genuine blocker. Promote a recurring, confirmed
lesson into its narrowest existing project/global document only when warranted,
rather than adding a rule after every attempt. This diagnostic routing is TRACE
operating policy. Official guidance supports explicit completion criteria, relevant
checks, diff review and concise guidance refined from recurring mistakes:
[Astra guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
and [Codex best practices](https://learn.chatgpt.com/guides/best-practices).

## Project dependency cleanup

The user authorizes idle dependency cleanup. This is TRACE operating
policy, not an OpenAI recommendation or proof a person has stopped using a project.
Only registered exact Git roots are examined; do not search every drive. Register
an approved project with `project_cleanup.py register --id NAME --path PATH --auto`.
Without `--auto`, it is held. Registrations and observations remain host-local.

- Begin observation at registration/first successful collection, never backdate
  inactivity from a last commit or old folder timestamp. Require 45 observed days
  without Git/content, install-root or manifest/lock changes. Missed/inaccessible
  intervals longer than 14 days, process-collection failure and possible runtime
  activity reset the observation period. Command lines are inspected transiently,
  never stored; a relative-path runtime can be ambiguous and blocks automatic deletion.
- Inspect only direct-child `node_modules`, Composer `vendor`, or uv `.venv` with
  an unambiguous manifest/lock pair, Git ignore coverage and no tracked contents.
  Before proposing/deleting, check the complete tree's write times and refuse all
  symlinks, junctions, special files and linked roots. Shared package stores,
  authentication, global installs, source, backups and other build outputs are excluded.
- Report an exact candidate, size and reinstall command. After actually notifying
  the user, run `reported --id NAME --artifact node_modules` once. Wait at least
  seven days from that notification before the fixed `prune` command can remove it.
  Unreported candidates never become eligible. Recheck identity, locks, contents and
  processes immediately before deletion. New activity cancels the grace period.
- `hold --id NAME` prevents automatic cleanup; `touch --id NAME` records active
  read-only/manual work and resets the idle clock. Users can resume work at any time.
  File reads outside observed tools may be invisible; no perfect inactivity detector
  is claimed. Linked installs are deliberately manual-only, including common
  POSIX virtualenv/bin or pnpm layouts. The tool never follows links into shared stores.
- Record verified removals and failures in one `cleanup-result.json`. Permission
  failure can leave a partial dependency directory; report it and reinstall using
  the pinned package manager/lock during authorized work. Source and lock files
  remain. Dependencies have no byte-for-byte managed-policy rollback. Do not hide
  unresolved errors or repeatedly force deletion. Logical size is not physical
  space reclaimed, especially with hard links.

Observations are kept in `cleanup-observations.json`, one current record per project.

## RTK lifecycle

`versions.lock.json` pins release assets for Windows x64 (the two supported PCs)
and Linux (CI only); other platform assets in a release are ignored. `tools.py install-rtk` verifies the release SHA-256, extracts only the
binary and checks its version before replacing an owned installation. One previous
binary is retained outside active paths; user-modified copies conflict. `tools.py
verify`, `tools.py rollback-rtk` and `tools.py uninstall-rtk` check ownership.
Runtime tools are separately owned in `tools-installed.json`, not copied into
Codex home, Git or a project. No PATH or shell profile is edited. Use `tools.py run`
or the verified absolute binary path. A new computer explicitly installs its own
platform asset; installing TRACE instructions alone does not install this binary.

RTK is a pinned tool (2026-10-16 decision). A new version arrives only as a reviewed pin
change in `versions.lock.json` and is installed by reset; nothing collects or adopts a release
automatically. Same-version asset drift is a conflict; the installed receipt records the asset
digest, and a receipt without that field is not treated as verified.
Standard RTK gain counts are estimates, not OpenAI usage. Run `verify_rtk.py --project PATH` during
approved maintenance for Git, TypeScript when installed, Unicode/space paths,
arguments, stderr and nonzero exit checks. It does not test every filter or imply
transparent hook loading. RTK's native auto-rewrite is not installed because of
its documented approval-classifier limitation; do not run `rtk init -g` as a
shortcut. See [conditional RTK guidance](../global/guides/rtk.md).

## Manifest schema

Manifest schema 2 has an optional `root: personal_skills` on file/retirement entries;
absent `root` means Codex home. Local keys use `@personal/` for personal-skill entries
and plain keys for Codex home. Records/journals bind both roots, and schema 1 records
stay readable. A blocked deletion remains unresolved; do not bypass the restriction.

## Troubleshooting and portability

Record reusable failures in the existing troubleshooting index: symptom, cause
(confirmed versus hypothesis, with the affected environment/version), fix with its
non-destructive diagnosis and side effects, and check. Delete a record whose fix no
longer applies. Do not universalize a version-specific workaround or record
authentication parameters.
Only project-specific incidents belong in the project.

Check C-only Windows, different checkout/home drives, Unicode and spaces, OneDrive paths, execution outside checkout, custom CODEX_HOME, missing/read-only paths and links/junctions. Only Windows is a supported host; Linux runs in CI only, and its install, repeat install, conflict and rollback behavior is not native host support. Simulated paths do not establish native OS support.

Sources: [Configuration and paths](https://learn.chatgpt.com/docs/config-file/config-advanced), [Authentication](https://learn.chatgpt.com/docs/auth), [App settings](https://learn.chatgpt.com/docs/app/settings).
