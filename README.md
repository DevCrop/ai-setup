# TRACE Setup v1.2.4

Portable Codex personal instructions, optional profiles, pinned Archify/Ponytail,
and ownership-based deployment. Python 3.11+ and Git are required; Node.js is needed
to render Archify. Use ChatGPT subscription login on each host. No API key and no
50/200-run model benchmark are required.

For the current reviewed development branch, start with the Korean
[2026-10-08 setup handoff](docs/setup-handoff-20261008.md): what changed, why,
host-specific authority, incident recovery, actual checks and another-PC acceptance.
Portable report UI sources are in [templates/reports](templates/reports/README.md).
Follow the [detailed Windows installation guide](docs/install-another-windows-pc.md)
for missing dependencies/folders, project packages, login and host-local scheduling.
The v1.2.4 tag remains the preceding published release; branch publication is separate.

For the final two-lane task/maintenance flow, per-diagnostic RTK routing and
confirmed-history review, see the Korean [shareable routine](docs/codex-routine-share.md).
The current branch carries these added policies; installing v1.2.4 does not.

The 2026-10-08 branch also includes an opt-in [RTK live viewer](docs/rtk-live-dashboard.md):
local read-only aggregate polling, visible-tab refresh, pause/error states and a
Windows launcher. The existing daily maintenance and stored probe timestamps
remain independent. No startup task, hook or public web service is installed.

## Install

Clone this repository anywhere, including paths with spaces and non-Latin names.
Run these commands from the checkout, or invoke the script by absolute path:

```text
python -B scripts/setup.py plan
python -B scripts/setup.py apply
python -B scripts/setup.py verify
```

For reviewed pre-existing personal instructions/profiles, inspect `plan --adopt-existing`
then use `apply --adopt-existing` once. This flag never overrides a modified file
already owned by TRACE. `--home` and `CODEX_HOME` select Codex home; `--state` selects
local deployment state. Defaults use supported per-user locations, not drive letters.
`--personal-skills` selects the separate personal skill root (default
`~/.agents/skills`); CODEX_HOME does not relocate it. For isolated checks, set
`--home`, `--personal-skills`, and `--state` to disposable locations together.
Keep the same roots for plan/apply/verify/rollback. Overlapping roots are refused.
The complete reviewed upstream skill packages are bundled in `vendor/` and managed
by the same manifest for offline installation, removal, and rollback. They retain
upstream instructions unchanged; the global working agreement limits applicability.
TRACE adds only `agents/openai.yaml` with implicit invocation disabled for these
two skills. Invoke `$ponytail` or `$archify` explicitly (or select the skill in the
app). This retains their full upstream procedures; it does not shorten the skills.
`setup.py` is the sole install/update/verify/remove entry point, including skills.

The personal `computer-use-workflow` skill is deployed to the supported user skill
root (`~/.agents/skills`, or `--personal-skills`) for use across projects. It follows
the available official Computer Use runtime and keeps browser/native execution
evidence separate. It is a TRACE-authored workflow, not an OpenAI-published plugin.
See [Computer Use maintenance](docs/computer-use-maintenance.md).

See [Ponytail·Archify usage examples](docs/skill-usage.md) for explicit selection,
task scope, intensity and completion criteria. The English personalization source
is [global/AGENTS.md](global/AGENTS.md); do not maintain a second edited copy.

## Lifecycle

```text
python -B scripts/setup.py rollback
python -B scripts/setup.py recover
python -B scripts/setup.py uninstall
python -B scripts/setup.py doctor --codex <executable-path>
python -B scripts/check_updates.py
```

`recover` handles a pending interrupted transaction. A single prior restore point
lives in private machine-local state, never in Git. Config restoration refuses
conflicting edits. Unmanaged files and credentials are not deleted. Close competing
setup/update processes before applying. A new session is needed to inspect effective
instructions; filesystem verification is not proof of app UI or model behavior.

Choose models in the app. Optional CLI commands: `codex --profile sol`,
`codex --profile astra`, `codex --profile astra-deep`. Profiles do not change
the persistent base model selection and do not implement automatic model switching.
The sol preset selects GPT-6.1 Sol Medium; existing app/base effort choices are preserved.

## Optional RTK and project maintenance

```text
python -B scripts/tools.py install-rtk
python -B scripts/tools.py verify
python -B scripts/tools.py plan-rtk-update
python -B scripts/tools.py run git status
python -B scripts/project_cleanup.py register --id NAME --path PATH --auto
python -B scripts/project_cleanup.py scan
python -B scripts/check_closure.py
```

RTK uses pinned, SHA-256-verified platform assets in private host state; no hook,
PATH edit, model/API call or per-project installation is required. The managed
`bin/trace_rtk.py` in Codex home can run from any project by absolute path, retaining
that project's working directory and local TypeScript version. RTK is third-party;
compressed output bytes do not prove OpenAI tokens or subscription savings.
Use raw project-native commands for final acceptance. See [operations](docs/operations.md)
and [official versus local policy](docs/decisions/002-maintenance-and-rtk.md).

The existing TRACE monitor checks registered projects and RTK releases at the
host-configured cadence. Cleanup
requires 45 observed idle days plus seven days after an actual candidate notification,
locked/ignored dependencies, certain process checks and no links or tracked content.
Unknown/active projects are retained; first registration starts observation today.
Use `project_cleanup.py hold --id NAME` or `touch --id NAME` to retain/mark active work.
Only the exact allowlisted dependency directory is removable; source, credentials,
global installs, stores and unregistered projects are excluded. Binary upgrades
require existing host authorization; do not register another monitoring host automatically.
The completion audit also catches unpublished release versions, deployment/tool
drift and registered projects awaiting their first scoped review. The existing
TRACE routine reports new actionable gaps proactively and retains previously
reported findings without repeating unchanged notices. The current host pre-authorizes compatible small guidance and stable CLI/RTK
updates after review and verification. Future remote publication requires separate
authorization; local applied and publicly released states remain distinct.

## Project adoption

Start with [the project authoring contract](templates/project/README.md). Reuse
existing rule documents; do not blindly copy the template into an existing repo.
This release does not install product-project rules. Registered project health and
RTK checks are separate from project onboarding. The current installation and
adaptive-maintenance flow lives in [codex-flow.html](diagrams/global/codex-flow.html);
the portable routine is documented in [the portable guide](docs/portable-routine.md).
Each project's diagram must live
in that project's own repository and describe inspected source.

## Checks and maintenance

```text
python -B -m unittest discover -s scripts -p 'test_*.py' -v
python -B scripts/validate_repo.py
python -B scripts/index_docs.py
```

See [documentation index](docs/index.md), [operations](docs/operations.md), and
[current release verification](docs/verification-adaptive-routine.md). Update detection produces review
candidates only. Preserve the designated host's existing schedule and authorization;
installing this repository does not create or transfer an automation. The current
observed TRACE host preserves Monday 10:00 Asia/Seoul weekly review. A separately
authorized daily maintenance routine may update stable CLI/RTK releases within its approved scope,
with integrity checks and verification; that authorization is not portable policy.
Broader policy, skills, hooks and permission changes need separate approval.
The October 5 host authorization permits only the bounded compatible updates
defined in operations; new computers remain review-only.
Inactive hosts cannot guarantee scheduled execution. No application-managed plugin
cache is copied.

## Migrating v1.0.1 and other computers

Use tag `v1.2.4` for a reproducible release checkout. On an existing TRACE host,
review `plan` before `apply`. Do not copy an entire Codex home between computers;
authenticate independently and preserve local model, MCP, permissions and app state.

The installer accepts previous ownership records and retires exactly reviewed
`encoding-safety/SKILL.md` and `official-source-workflow/SKILL.md` under the personal
skill root. Modified copies conflict even with `--adopt-existing`. The UTF-8 policy
is in the agreement, source procedure in its conditional guide, and database notes
in the optional project reference. Only empty parents of removed files are pruned.
One local restore point contains their prior bytes; credentials and raw backups
must never be committed. `doctor` reports additional personal skills, which can
make another computer's effective context differ. Whole-home cleanup remains separate.

`doctor` and `verify.unmanaged_skill_findings` also report directories missing
`SKILL.md`. These findings are review candidates, not permission to delete user files.
A managed-file verification pass does not mean that the entire Codex home is clean.

## Routine completion contract

The existing TRACE routine follows detection → original-source review → applicability/
authorization decision → compatible application → affected checks → closure audit.
Implementation establishes the outcome/scope/checks first, then reviews the affected
diff before completion. Repeated failures trigger diagnosis rather than an unchanged
retry. Project-specific rules and commands stay in the project's canonical guidance.
Official article discovery covers OpenAI news, developer posts and product updates.
A version match alone cannot clear changed managed files or a stale published-asset
receipt. Pending/unknown work is retained and reported proactively when actionable.
The portable prompt source is [templates/maintenance-prompt.md](templates/maintenance-prompt.md);
render it with `python -B scripts/render_heartbeat.py --automation-id EXISTING_ID`
on the designated host. The ID must match that host's private authorization record;
the backward-compatible default is `trace`.
Rendering does not create a monitor, grant host authority or update the scheduler.
Do not install a second monitor on a new computer.

For the current adaptive routine, exact boundaries and another computer's install/
acceptance checklist, see [the portable setup guide](docs/portable-routine.md) and
[branch verification evidence](docs/verification-adaptive-routine.md). Scheduled collection,
per-invocation local RTK checks and responses to observed failures are separate;
this repository does not install an event daemon or perform model training.

The published v1.2.4 retains the preceding agreement. This development branch
adds active-root/tool/acceptance routing and verified RTK for every supported
diagnostic, including nested orchestration, while retaining native evidence and
final acceptance. Confirmed feedback, minimal changes and retirement live in
conditional guidance and the existing private routine state. Efficiency means correct completion with less
avoidable rework and total task usage when observed, not a shorter prompt alone.
RTK release planning reuses collection, preserves stable pins and reports conflicts
before installation. Unchanged checks are reused only with matching identities.
