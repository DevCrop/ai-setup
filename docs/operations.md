# Operations

For browser/native UI capability checks, installed SDK ownership, sanitized failure
records and narrowly scoped home cleanup, follow
[Computer Use maintenance](computer-use-maintenance.md). The saved host schedule
and separately approved dependency-cleanup policy remain authoritative.

Start from the repository README and installer help for executable commands. Resolve paths from the script location, explicit root and supported user directories; never assume a drive letter or current shell directory. Honor CODEX_HOME. Authenticate separately on each host with the installed CLI's supported ChatGPT login flow; do not copy auth files into this repository.

## Managed lifecycle

Run plan before apply. Inspect additions, changes, removals and conflicts. Apply only approved owned files; preserve user edits, permissions, model selection, MCP secrets and unrelated settings. Verify after apply. Keep one previous managed state in the local state directory for rollback, not backup copies in active paths. On failure restore that state and report conflicts. Installer-owned temporary artifacts are cleaned after success; application caches, sessions and credentials are not general cleanup targets.

## Profiles and fresh sessions

The optional CLI profiles are `sol`, `astra` and `astra-deep`. They are separate `.config.toml` files selected with `--profile`. Check host model support; the app composer remains user-controlled. A parsed configuration is not proof of a fresh session's effective instruction or model behavior. Inspect new-session loading separately. Legacy overrides and project trust can affect effective configuration.

## Designated-host maintenance

Preserve the operating host's actual registered automation, cadence and authority.
The observed monitor on this installation is weekly Monday 10:00 Asia/Seoul;
another host's daily routine is not permission to change it. The merged PR #9
records a separately authorized daily maintenance context, not this scheduler.
On 2026-10-05 the user authorized compatible small global guidance and stable
Codex CLI/RTK updates after review and verification on the recorded host only.
This does not create a monitor, transfer ownership, change cadence or apply to
another computer. The existing exact dependency-cleanup exception is separate.
Shared policy supplies a procedure; private authority and the actual scheduler
supply scope and timing. Record each independently.
Machine-specific checkout paths and project registrations belong in private
`cleanup-projects.json` beside deployment state, never in shared policy. A new computer
does not inherit monitoring ownership merely by installing this repository.

### Working routine

| Trigger | Scope | Completion |
|---|---|---|
| First project registration | Inspect applicable instructions, runtime, existing checks and project flow if present | Record findings and unknowns; do not invent missing configuration or diagrams |
| Normal implementation | Relevant project rules and affected code | Run task-appropriate acceptance checks; preserve unrelated edits |
| Existing scheduled heartbeat | Official guidance/articles/products, managed installation and registered project deltas | Apply pre-authorized compatible updates, verify actual results and report only meaningful changes or required decisions |
| Architecture/dependency/rule change | Affected contracts, documentation and verification commands | Review semantic consistency and run relevant checks after an authorized change |
| Approved maintenance | Exact reviewed files and versions | Apply, verify, account for removals and preserve rollback |

### Evidence-based improvement

The designated host's 2026-10-07 request adds an evidence-based feedback review to
its existing scheduled routine. Follow global/guides/official-source-workflow.md for
capture, diagnosis, promotion and retirement. Maintain preferences and lessons in
the single private routine-review.json; its public/local report is a sanitized
projection, not a second authority store. Review available authorized feedback,
not all conversations or raw session files. Preserve this monitor's separately
recorded cleanup authority and any other cleanup monitor, permissions, model/effort
and quiet notification behavior. Rendering deletion scope requires a matching
host/automation and a separate `dependency_cleanup` approval; otherwise it is
read-only. Never copy another host's inactivity threshold or protected-project policy.
Only new actionable findings, verified improvements or needed decisions notify.
Do not report a saved schedule as proof that a future run already occurred.

### Maintenance and observation cadence

This is local operating policy, not a vendor-prescribed release frequency.
Use the existing schedule plus observations made during active authorized work;
no additional scheduler, hook or background event service is installed.

| Activity | Trigger | Action |
|---|---|---|
| Stable CLI/RTK release discovery | Existing registered cadence | Review relevant changes; install only an eligible changed release |
| RTK ownership/hash | Each explicit owned-runner invocation | Existing local checks; no network lookup |
| Output compression | Every needed supported diagnostic, including nested orchestration | Use verified RTK; preserve exits/evidence and native exact reads, structured data, mutations and final acceptance |
| Compression path health | Changed tool/filter identity or relevant failure | One affected byte/exit/evidence check; reuse matching success |
| Affected runtime revalidation | Tool/filter change or new relevant failure | Smallest affected existing checks; reuse unchanged evidence |
| Feedback and failure handling | Observation in active authorized task | Diagnose and finish authorized fix now; retain summary for scheduled review |
| Aggregate/UI refresh | Existing successful collection | Replace same-date snapshot; preserve unknown/missing days |

### Normal implementation contract

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

### Collection, review and cost controls

1. Run `python -B scripts/check_updates.py`; inspect new and retained candidates.
   R01 Astra guidance remains the primary instruction-design source. Discover
   published articles through the official developer blog (R38), OpenAI news RSS
   (R47, latest 60 entries) and product-update index (R48); scheduling guidance is
   R46. New/edited first-party URLs are preserved rather than stripped with HTML.
   An initial index is a collection baseline, not semantic acceptance of its links.
   Review relevant current entries once; later review only new/edited entries and
   unresolved relevant articles. Open the original article and applicable current
   Codex docs before changing policy. Titles, feed summaries and hashes alone are
   not adoption evidence. Direct access failure can use an available official web
   retrieval tool; if the original cannot be read, keep it unknown and do not apply.
   Prioritize Codex subscription/MCP/full-stack guidance. API-only prices, cloud,
   Pro 500, advertisements and unsupported client features are not local requirements.
2. Run `python -B scripts/setup.py verify`. Treat unmanaged skill findings separately
   from managed-file integrity; neither proves whole-home cleanliness or runtime loading.
3. For each registered project, check path availability, Git HEAD and working-tree
   changes, including relevant untracked instructions. Inspect only changed rules,
   configuration, package/runtime pins, scripts and affected source. Check the selected
   runtime against a project pin when present. An unchanged dirty filename list is
   not evidence of unchanged content: compare content/diff fingerprints too.
4. Only meaningful changes or failures trigger model review. Do not reread the
   entire reference inventory or project. Default to direct review; use bounded
   delegation only when independent work justifies it. Do not schedule model benchmarks.
5. Run `python -B scripts/tools.py verify` and `python -B scripts/project_cleanup.py scan`.
   Do not execute arbitrary project scripts, dependency installs, builds or browser
   tests during the heartbeat. Approved CLI/RTK installation and affected existing
   setup verification are covered by the bounded update section below. The sole deletion exception is the pre-authorized dependency
   policy below, executed only by `project_cleanup.py prune`. Recommend the smallest checks for other candidates;
   execute them during approved implementation. Missing paths and failed collection
   stay unknown/failed, not healthy. An offline host cannot guarantee scheduled execution.
6. Run `python -B scripts/check_closure.py`. Verify actual owned file/config
   integrity, then compare checkout, installed policy,
   reviewed CLI/RTK and latest GitHub release versions. Inspect the existing PR's
   final-head checks and immutable tag/artifact identity when publication differs.
   A merged PR, prepared package and installed policy are separate from a published
   release. The current published tag/commit and GitHub ZIP digest must match
   private `release-verification.json`; a stale/missing receipt requires a fresh
   download and disposable-root install/repeat/removal/restore validation. Missing
   GitHub access is unknown, never successful publication.
   For a registered project with no recorded substantive review, perform one scoped
   initial instruction/configuration/acceptance-contract review even when its
   content fingerprint is unchanged. Do not equate collection or a dirty file list
   with completed onboarding. Do not edit its source or manufacture a project flow.

### Completion audit and notification

At the end of each routine, reconcile unresolved stable findings with the collected
evidence. Each actionable candidate should name exact target files/versions, impact,
the smallest relevant checks and whether approval or session evidence is required.
Report new unfinished release/install/migration work proactively, without waiting
for the user to ask what remains. Keep previously reported pending work quiet unless
its evidence, impact, severity or resolution materially changes. Do not repeat a
notice merely because time passed. Collection never clears a finding automatically.

Before a managed update is approved, compare the assets TRACE actually installs,
not just an upstream tag or commit message. An identical managed skill hash can
justify keeping its pin despite unrelated plugin/hooks releases. A deliberate
deferral has a version/hash, reason and reconsideration trigger; it is not a claim
of runtime validation. Preserve unresolved candidates removed from the watch list
until an exact-content review resolves them. Use current [OpenAI plugin examples](https://github.com/openai/plugins)
and [plugin packaging guidance](https://developers.openai.com/plugins/build/plugins)
for future examples; the deprecated skills catalog remains historical evidence.

CLI `debug prompt-input` can confirm rendered global/project instructions without
a model call. Keep only hashes and presence checks in private evidence, never raw
prompt contents. It does not prove model obedience or desktop UI loading. Compare
the actual session permission context with defaults using the documented
[configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic)
and [developer settings](https://learn.chatgpt.com/docs/developer-settings).
Do not change permissions to make a check pass or label an override an installer fault.

Keep one current local routine record beside source-monitor state (not in project
files). Track last attempt, last successful collection, last substantive review,
last policy application, per-project inspected commit/content fingerprint and
unresolved findings. Each finding has a stable identity, evidence, impact, proposed
action, validation and last-notified fingerprint. Retain unresolved findings across
unchanged checks; do not equate a new collection timestamp with resolution. Keep
history in Git where appropriate, not dated operational copies. Never store source
diff bodies, credentials or authentication parameters in the routine record.

Stay quiet when unchanged, non-actionable or already reported without material new
information. Notify on new actionable findings, changed severity/impact, confirmed
resolution or a failure requiring action. Record known missed runs honestly; do not
infer missed executions from timestamp gaps alone. A file hash change is a trigger
for review, not proof of a policy change or a fault.

### Pre-authorized automatic changes and post-update checks

The 2026-10-05 approval is host-local. Record it in private `routine-review.json`
and the existing automation prompt; the portable prompt template defaults to
review-only on a new computer. It authorizes analysis, relevant verification,
compatible small global Markdown changes, stable CLI/RTK upgrades and local Git
history. It does not authorize arbitrary new features or future remote publication.
Prior task-specific release approval does not authorize future remote publication;
GitHub writes require current standing or case-specific publishing authorization.
Report any unpublished local update proactively rather than calling it distributed.

A compatible small batch changes at most three existing manifest-owned Markdown
files under `global/AGENTS.md` or `global/guides/`, with at most 120 nonblank added/
removed lines in total. Keep the agreement at most 2,400 UTF-8 bytes. These are
TRACE scope bounds, not official optimal numbers. Registry/snapshots, reviewed
version pins and release bookkeeping are allowed only to support that same batch.
Do not add executable setup logic, dependencies, skills/plugins, new managed paths,
project files or a new architecture under this exception. Do not remove durable
user preferences, change model/effort/tier, agent limits, MCP/auth, hooks/trust,
permissions, scheduler identity/cadence or broaden this authorization.
Semantic compatibility is required as well as size: conflicted/uncertain guidance
or a consequential behavior change remains an exact sourced approval candidate.

For each eligible batch:

1. Confirm a clean source checkout, exact owned targets, current instruction and
   tool hashes, no pending install transaction and no concurrent maintenance.
   Preserve user edits; a conflict blocks automatic replacement. Record the
   exact official article/version/hash, relevant claim, applicability and intended
   diff before applying; a first successful collection does not establish a review.
   Establish the batch's intended result, owned scope and affected acceptance
   checks before applying, without expanding project or publishing authority.
2. Use existing installer plan/apply/verify and one prior restore point. Stable
   CLI comes from the official npm package after release review; stable RTK uses
   published asset digests through the existing owned tool installer. Review
   breaking/permission changes instead of adopting a stable label blindly.
   Do not modify app binaries, credentials, PATH, hooks or sandbox settings.
3. Run smallest relevant checks: repository integrity/index/hash/link validation,
   repeated unchanged install, and global/project CLI rendering after instruction
   changes (only presence/hashes; no model call). Use local disposable lifecycle
   cases for installer changes, never destructive checks on the real home.
   After CLI updates verify version, existing ChatGPT login and rendering; after
   RTK updates verify ownership, arguments/exits and relevant raw/filtered evidence
   using `verify_rtk.py`. Do not run unrelated product builds/browser suites.
   Review the affected diff against the reviewed claim, authorization and project
   boundary; check results do not replace this semantic review.
4. On failures restore the previous owned policy/tool state, verify the restored
   state against its matching source revision, preserve evidence and report the
   exact blocker. Do not repeatedly retry an unchanged failed candidate; retry
   only with new evidence, a changed version or an explicit retry request.
5. Record local Git history for owned source changes and distinguish applied,
   verified, committed and published states. Do not automatically push/merge/tag
   without publishing authorization. If publication is authorized, check final
   commit CI, immutable tag, downloaded ZIP digest and disposable installation.
6. Rerun affected deployment/tool/closure checks and reconcile stable findings.
   Inspect new or retained actionable gaps before stopping; continue authorized
   fixes until acceptance is met. Changed session/skill behavior that was not
   executed remains unverified. No measured token/performance gain is inferred.

Keep one current private record: collection, substantive review, policy application
and verification timestamps are distinct. Maintain per-article canonical URL,
normalized/exact available hash, decision, target/impact/validation and retained
review backlog; do not silently accept older links or discard an unresolved article
when it leaves an index. Store evidence hashes/presence, not prompts, raw diffs,
secrets or command lines. A deferred update needs a reason and reconsideration trigger.

Stay quiet on unchanged or irrelevant updates and previously reported pending
findings. Notify meaningful successful changes, confirmed resolutions, failed
checks/rollback, a new actionable gap or the smallest required user decision.
Do not wait for the user to ask what remains. Without a material change do not
repeat that same question/notice. Local execution needs the host powered on and
app running; track known failed/missed attempts, never invent scheduler history.

New skills/plugins, permissions, model changes, structural changes and project
edits require separate scope approval. Preserve the exact dependency cleanup
policy below; it is not expanded by automatic global maintenance. Never overwrite
project docs or infer deletion permission from an official article.

Source reports retain `pending` candidates across unchanged fetches. The success
marker records collection time; installed state `applied_at` records deployment,
not source acceptance. Older records without timestamps remain unknown. After
review, use `check_updates.py --resolve ID --expected-sha HASH --reason TEXT` to
record a decision about that exact candidate; this never applies policy. Typography,
GitHub statistics and example model names alone do not justify policy edits.
Quote styles are normalized; other relevance decisions require review. Report
known missed runs honestly; a timestamp alone cannot establish scheduler history.

## Project dependency cleanup

The user authorized idle dependency cleanup on 2026-10-01. This is TRACE operating
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

The same registry supplies weekly project health scope; do not maintain a second
path inventory in policy. `cleanup-observations.json` holds one current observation
per project, separate from semantic-review evidence in `routine-review.json`.

## RTK lifecycle

`versions.lock.json` pins release assets for supported Windows, macOS and Linux
architectures. `tools.py install-rtk` verifies the release SHA-256, extracts only the
binary and checks its version before replacing an owned installation. One previous
binary is retained outside active paths; user-modified copies conflict. `tools.py
verify`, `tools.py rollback-rtk` and `tools.py uninstall-rtk` check ownership.
Runtime tools are separately owned in `tools-installed.json`, not copied into
Codex home, Git or a project. No PATH or shell profile is edited. Use `tools.py run`
or the verified absolute binary path. A new computer explicitly installs its own
platform asset; installing TRACE instructions alone does not install this binary.

Release collection produces candidates. `tools.py plan-rtk-update` reads its exact
current successful RTK record, checks stable tag/platform asset identities and
reports unchanged, a candidate, or a blocked/older release. It makes no network
call or pin/install change. Missing, failed or mismatched evidence is unknown, not unchanged.
Same-version asset drift is a conflict; the installed receipt records the asset
digest for new installs. An older receipt without that field remains limited
historical evidence, not retroactively verified. Review the exact release notes
and all supported platform digests before changing the pin.
Automatically adopt a stable binary only
within the recorded compatible-tool authorization and its post-update checks. Standard RTK gain
counts are estimates, not OpenAI usage. Run `verify_rtk.py --project PATH` during
approved maintenance for Git, TypeScript when installed, Unicode/space paths,
arguments, stderr and nonzero exit checks. It does not test every filter or imply
transparent hook loading. RTK's native auto-rewrite is not installed because of
its documented approval-classifier limitation; do not run `rtk init -g` as a
shortcut. See [conditional RTK guidance](../global/guides/rtk.md).

## Manifest migration

Manifest schema 2 adds optional `root: personal_skills` to file/retirement entries;
absent `root` means Codex home. Local keys use `@personal/` for the former and retain
v1 keys for Codex home. Records/journals bind both roots. V1 records remain readable.
After rollback to v1.0.1, use its checkout to verify that version. A blocked deletion
remains unresolved; do not bypass the restriction.

## Troubleshooting and portability

Record reusable failures in the existing troubleshooting index: symptoms, affected
environment/version, confirmed cause versus hypothesis, non-destructive diagnosis,
resolution, verification, side effects/restore, evidence and last verified date.
Do not universalize historical workarounds or record authentication parameters.
Only project-specific incidents belong in the project.

Check C-only Windows, different checkout/home drives, Unicode and spaces, OneDrive paths, execution outside checkout, custom CODEX_HOME, missing/read-only paths and links/junctions. Also verify native macOS/Linux install, repeat install, conflict and rollback behavior before declaring those platforms tested. Simulated paths do not establish native OS support.

Sources: [Configuration and paths](https://learn.chatgpt.com/docs/config-file/config-advanced), [Authentication](https://learn.chatgpt.com/docs/auth), [App settings](https://learn.chatgpt.com/docs/app/settings).
