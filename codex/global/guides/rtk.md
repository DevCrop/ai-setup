# RTK command output

Load when choosing output handling for development diagnostics. RTK is a third-party output filter, not an OpenAI feature or proof of subscription token savings. TRACE pins the reviewed release in versions.lock.json and installs one binary into private host state with scripts/tools.py install-rtk. No shared machine path, credentials, permission change, PATH edit, injected RTK.md or transparent rewrite hook is installed.

Use scripts/tools.py verify from the setup checkout to locate the owned binary, or scripts/tools.py run git status for explicit filtering. Use the verified runner for every supported read-only diagnostic invocation by default, including short output. Keep searches narrowly scoped; short output can have zero savings. Do not add a diagnostic or repeat it merely to generate a gain record. Preserve arguments, exit codes and needed evidence. Read exact source code and authoritative acceptance-check output directly; rerun the original command when filtering obscures failures. Never interpret rtk gain estimates as actual OpenAI billed tokens or included allowance saved.

Outside the setup checkout, run the managed `bin/trace_rtk.py` in Codex home by absolute path with Python. Resolve Codex home from CODEX_HOME, otherwise the supported user home `.codex`; for example pass `git status` as arguments from the current project directory. The runner derives private tool state from that home, verifies the binary ownership/hash and preserves the caller's working directory. No project-local RTK files or extra project installation are needed. Custom deployment `--state` locations require tools.py --state STATE run instead; they are not guessed by the global runner.

For JavaScript/TypeScript tools, use the TRACE runner from the project working directory: it temporarily prioritizes that project's node_modules/.bin, blocks implicit npm downloads and disables RTK telemetry for the invocation. Direct rtk tsc can choose a global compiler; this was observed on Windows. Do not infer matching tool versions from two successful exits. Use the project-native acceptance command for final verification. The runner does not modify persistent PATH.

Do not transparently wrap deletes, installs, migrations, publishing, authentication or security decisions. Upstream's Codex hook rewrites commands before native approval checks, whose safety classifier does not unwrap RTK; this may obscure mutating-command signals. Hook setup is a separate opt-in review, with official /hooks trust, and is not included in this release. Do not bypass hook trust or add sandbox writable roots to make analytics work. Keep local analytics outside Git; analytics write failure does not establish filtering failure.

Sources: [RTK 0.51.0 release](https://github.com/rtk-ai/rtk/releases/tag/v0.51.0), [pinned Codex integration](https://github.com/rtk-ai/rtk/blob/v0.51.0/hooks/codex/README.md), [OpenAI hooks](https://learn.chatgpt.com/docs/hooks).

## Savings reporting

When reporting efficiency, use the verified runner's `gain --daily --format json`
aggregate snapshot; keep command text and project paths out of reports. Label
counts as local recorded invocations and values as RTK token estimates, never
OpenAI usage, money saved or subscription quota. Historical records may include
other RTK versions, repeated diagnostics and fixtures; do not attribute all savings
to the current runner. Compare arithmetic totals and disclose inconsistencies.
Pair estimates with a scoped raw/filtered byte comparison, exit/evidence checks
and recall/fallback limitations. Missing records mean unknown, not zero benefit.
On the authorized scheduled routine, collect date-keyed aggregates into one
current private record. Refresh an optional authorized chart only when its local
data/template contract exists; no duplicate totals or routine notifications.
Preserve recorded date/timezone limits and missing days as unknown. Reuse a matching successful raw/runner check. Changed tool/filter identity or a
relevant failure justifies one affected read-only comparison, counted separately.
Other hosts need their own authorization. Do not run commands to increase gain.

## Existing host integrations

Earlier host guidance used a user-local PATH binary and an opt-in native hook.
The v1.2 installer neither removes nor upgrades that separately owned integration.
Prefer the verified TRACE runner to avoid silently selecting a second binary.
Inspect any existing hook with the supported Codex `/hooks` review and trust flow;
do not alter trust records or assume a processor smoke test proves desktop
interception. A CLI upgrade and a desktop app update are separate operations.
Do not copy host-local sandbox recovery paths or older 0.50.0 asset hashes into a
new computer. Preserve unrelated hooks, credentials, environment and permissions.
Sources: [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference),
[Hooks and trust](https://learn.chatgpt.com/docs/hooks).

## Use, release review and validation timing

Use the owned runner on every actually needed, supported read-only diagnostic
invocation. Exact source reads, machine-readable JSON, mutating operations and
final acceptance use native output; do not add checks only to increase savings. Ownership
and SHA-256 verification already run per invocation in trace_rtk.py. This is a
local runtime check, not a network release lookup or universal hook interception.

Keep stable-release discovery and date-keyed gain collection on the existing
registered cadence. `tools.py plan-rtk-update` reuses the current source collection
and checks the stable tag, every pinned platform asset and exact digest/URL. It
never approves, installs or changes the version lock. Missing evidence, duplicate
assets, changed same-version assets and older releases block automatic adoption.
Review breaking changes before updating pins; use the owned installer, verify,
affected runtime checks and rollback on failure. Same versions are not reinstalled.
Count any affected raw/filtered comparison separately as validation. A changed RTK/CLI version, filter or relevant new failure
triggers only the affected existing checks during approved work, before relying
on the changed path. Do not reinstall an unchanged release or run probes at every
task start. Use native output immediately if compression hides needed evidence.
Confirm release compatibility before installation; stable releases may change
argument handling. Preserve existing hooks, trust, permissions and tool selection.
A task-observed failure is handled in that task, then summarized for scheduled review;
this does not install an event listener or authorize unrelated project commands.

## Per-invocation routing preference — 2026-10-08

This user explicitly wants RTK used whenever an eligible diagnostic runs. Resolve
`CODEX_HOME/bin/trace_rtk.py` once per task and pass the diagnostic arguments to
that runner, retaining the project working directory. In Python orchestration,
invoke Python plus that runner rather than hiding a bare diagnostic in
`subprocess`. PowerShell environment setup does not itself need filtering. Read
code files and structured JSON directly; never use `rtk proxy` to pretend that
an unsupported command was compressed. A native hook recognizes only supported
command forms and does not recursively inspect Python or PowerShell programs.

An existing opt-in hook may also rewrite simple diagnostics automatically. Its
configuration, trust and legacy binary are separate from the verified runner;
keep their evidence separate. The existing hook can be restricted with RTK's
user-owned `[hooks].exclude_commands` setting for mutating command families.
Review and test those exclusions against every installed hook binary before
relying on them. Exclusions narrow rewriting; they are not an execution permission
policy. For exact native commands use the verified executable directly, and
retain the platform's normal approval and sandbox checks. Changing a hook
definition still needs official `/hooks` review; never edit its trust hash.

Sources: [RTK hook exclusions](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/core/config.rs),
[rewrite prefix matching](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/discover/registry.rs),
[Codex hook behavior and trust](https://learn.chatgpt.com/docs/hooks).
