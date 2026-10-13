# Computer Use maintenance verification — 2026-10-08

## Verified changes

| Requirement | Actual evidence | Scope / limit |
|---|---|---|
| Stable tools | Codex CLI 0.161.0; RTK 0.51.0; Node 22.23.3; npm 10.9.9; Corepack 0.36.0; tsx 4.23.15; TypeScript 7.0.2 | User runtime stays on Node 22 LTS. Application-managed bundles and project pins are separate. |
| Artifact integrity | Node executable matches official SHASUMS256; Codex executable matches official release digest; RTK owned-binary verification passes | SHA-256 verification is not a model-behavior or all-command compression claim. |
| Global skill | `computer-use-workflow` passes the official Skill Creator validator; three files deployed to the personal skill root | TRACE-authored guidance based on official docs; official plugin remains the executor. |
| Cross-project discovery | CLI app-server `skills/list` returns exactly one enabled skill from three unrelated working roots | Actual discovery without a model call. Desktop selection/invocation still requires runtime evidence. |
| Portable lifecycle | Native Windows custom CODEX_HOME, separate personal root, Unicode/spaces and execution outside checkout: plan/apply/verify/repeat/uninstall/restore pass | User fixture preserved. Not a claim of new native macOS/Linux testing. |
| Repository regression | 76 tests ran: 72 passed, four platform skips; repository integrity/index checks pass | Runtime UI checks remain separate from unit tests. |
| SDK ownership | No user-global OpenAI Python/Node SDK installed; official releases compared without adding unused SDKs | Bundled SDKs, if any, update through their owner; unregistered projects were not scanned. |
| Routine | Existing host automation updated with tool/source review, compact incidents and narrow cleanup; schedule/thread retained | Daily 08:00 Asia/Seoul is this host's policy, not a new-host default. |
| Cleanup | Four inactive superseded state temporary files removed (3,178,360 bytes); npm's cache verifier collected 382 unused entries (487,397,400 bytes) | 490,575,760 bytes removed; this is not net disk change after updates/restore points. History, current state/backup and active runtimes retained. |

## Runtime acceptance

Fresh verification on 2026-10-08 with official native skill bundle 26.1002.52244:

- Official native initialization and app/window enumeration succeeded. A task-opened
  Calculator accepted a sign-toggle click (6 to -6), then a fresh-observation click
  restored 6. The test window was closed and its absence verified.
- Calculator returned null accessibility. Screenshot fallback initially showed a
  different app; no input was sent to that image. Explicit target activation and
  re-observation restored the correct screenshot before the successful clicks.
- Official in-app browser initialization succeeded. The public Browser documentation
  rendered, its Computer Use link opened the expected page, and Back restored the
  original route. The test tab was closed.
- Chrome's connected extension opened a separate task tab, followed a visible
  documentation link, restored history and verified the destination heading/URL
  after navigation settled. A screenshot confirmed rendering. Only the test tab
  was closed; existing user tabs and profile permissions were not changed.
- The current session also exposed the personal workflow skill. Earlier three-root
  discovery and isolated lifecycle evidence remain applicable.

The earlier kernel-assets failure is **resolved for the exercised paths**; its
underlying cause is unknown. The bundle changed between failing and successful
attempts, which does not prove causality. See [the incident](troubleshooting/incident-08-kernel-assets.md).

The browser tool rejected a local file URL under its protocol policy. No alternate
driver, proxy or rehosting was used. Local report data/template consistency is
verified separately; this run does not establish new visual verification of that
file page. Browser and Calculator checks do not guarantee every app, permission,
future session or model action.

## Handoff branch acceptance

The `codex/global-setup-handoff-20261008` branch consolidates these reviewed changes
with the active-project error workflow, a Korean handoff and portable report templates.
The preceding v1.2.4 release/tag/artifact remains unchanged.

On 2026-10-08 the final handoff payload passed the existing 76-test suite (72 passed,
four platform skips) and offline repository validation (120 managed files,
53 references, three skills). The affected installed agreement/guide matched source;
plan changed only those two owned files, verify passed and repeat apply was unchanged.
The current session exposed the new error-routing agreement. Configuration and the
separate weekly automation retained their exact hashes; daily 08:00 and thread identity
were read back from the actual saved automation. No model calls were made.

Portable report checks covered unique IDs, internal anchors, one data placeholder,
font asset and absence of host paths. A Node VM harness executed three cases:
RTK without telemetry, RTK with an explicitly synthetic one-row fixture, and the
adaptive report without host registration. Missing telemetry rendered unknown,
the synthetic chart/table rendered, and an unregistered schedule stayed unregistered.
The harness is script/DOM logic evidence, not a new browser screenshot or all-browser test.
The synthetic fixture is not a user usage record and is not included in the repository.

The host report's outdated daily compression-probe row was aligned with the existing
conditional revalidation policy without collecting new calls or changing collection time.
Published templates omit host-specific aggregate/history and parameterize the schedule.
Template publication does not install a collector or automatically create report pages.

Local application, branch/PR publication, main merge and a new tagged GitHub release
remain separate. Check the PR's exact commit and live checks before calling cross-platform
CI complete; the historical evidence above does not test another person's computer.
