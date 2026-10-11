# Computer Use and runtime maintenance

TRACE's `computer-use-workflow` is a personal, globally deployed workflow skill
based on official sources. The OpenAI plugin supplies the actual execution tools.
Installing the skill neither installs that plugin nor grants browser/app access.
The skill is discoverable normally, including outside the TRACE checkout; invoke
`$computer-use-workflow` explicitly when testing its behavior in a new session.
Ponytail and Archify retain their separate explicit invocation policy.

## Daily review and task-time recovery

Use the existing designated host routine and its saved local schedule. Compare
current CLI/RTK stable releases, installed SDK/CLI inventory and the current official
Computer Use, browser, extension, skills, best-practice and release documentation.
Do not install an SDK just because it has a newer release. Project-pinned packages
and application-managed dependency bundles have separate owners; never run a global
package update across them. A bundled tool updates through its owning application.

Review changed relevant original content and retained unresolved incidents. Store
per-URL identity/applicability, decision and validation in the existing private
routine-review.json. Reuse unchanged evidence. Track SDKs only where installed or
explicitly required; a package-manager error is unknown, not an empty inventory.

Check managed skill files during normal integrity verification. Exercise affected
UI behavior after tool/skill changes or when a task reproduces a failure. An idle
daily routine must not take over the desktop, launch arbitrary project servers or
create artificial compression calls. Host availability, plugin setup, file loading,
browser execution, native execution and model behavior are separate evidence levels.
Within browser evidence, distinguish the built-in browser from the Chrome extension.
Honor explicit tab/profile selection, reuse live bindings, verify navigation after
the destination is visible and retain user tabs. Surface-specific failures and
permission blocks belong in the same compact incident ledger; do not broaden
browser access to make a test pass. Reuse unchanged successful evidence instead
of scheduling a synthetic test on both browsers every day.

Incidents use stable IDs and include stage/surface, sanitized error signature,
first/last observation, tool identity, recovery attempt/result, impact, next action,
validation state and last-notified fingerprint. No raw page content, screenshots,
secrets, raw prompts or command histories belong in this shared repository or ledger.
Only a successful relevant check resolves an incident; collection alone does not.

## Cleanup boundary

The requested home cleanup preserves authentication, configuration, hooks, plugins
and their active runtime assets, conversations, SQLite databases/WAL/SHM, attachments,
project sources and the one prior valid restore point. Cache is not synonymous with
unused: active browser profiles and bundled runtimes may be required for execution.

Inventory narrowly. Remove only exact owned temporary files or stale cache entries
whose producer, inactivity and regeneration are established; record before/after
bytes and retained categories. Reject linked/reparse paths, uncertain ownership and
active files. Never delete history databases to reduce apparent disk usage. Keep
the separately authorized node_modules routine's actual cadence, seven-day threshold
and protected projects; this workflow does not broaden its scope.

## Acceptance

- Official sources and installed versions have dated review evidence.
- New skill passes structural validation and deployment plan/apply/verify/repeat;
  custom-home and unrelated-working-directory lifecycle checks preserve user files.
- Browser and native Computer Use each have explicit successful runtime evidence,
  or a named unresolved limitation. One cannot stand in for the other.
- Cleanup records exact approved categories and actual removed bytes; history and
  authentication remain intact.
- The saved host automation retains its schedule/owner/notification settings while
  including this review and incident process. New hosts require their own approval.

Sources: [Computer Use](https://learn.chatgpt.com/docs/computer-use),
[Browser](https://learn.chatgpt.com/docs/browser),
[Extension](https://learn.chatgpt.com/docs/chrome-extension),
[Skills](https://learn.chatgpt.com/docs/build-skills).
