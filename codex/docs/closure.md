# v1.0.1 closure audit

## Corrected behavior

- Uninstall restores only currently owned config keys. A key released by an earlier update belongs to the user and is no longer overwritten.
- Repeated uninstall is a no-op and preserves the usable restore point.
- Uninstall checks for concurrent edits and verifies the resulting files before declaring success.
- Verify checks the installed version and ownership hashes as well as file contents.
- Source monitoring exits nonzero on fetch failure, keeps the last success marker, and removes discontinued source entries from its current local index.
- HTML monitoring prefers the main/article body to reduce navigation noise. A text hash remains a review candidate, not proof of a meaningful policy change.
- One manifest lifecycle owns bundled skills; the duplicate bootstrap script was removed.
- Source hashes, diagram hashes, config values, document links, and the generated documentation index are now release checks.

## Flow and rule mapping

| Behavior | Authoritative location | Verification |
|---|---|---|
| Global work and delegation policy | [Global agreement](../global/AGENTS.md) | Fresh CLI prompt rendering; model compliance remains separate |
| Installed files and retired targets | [Manifest](../manifest.json) | setup.py verify and lifecycle tests |
| Upstream package versions | [Version lock](../versions.lock.json) | Exact vendored file hashes |
| Official source decisions | [Source registry](../references/registry.json) | Snapshot hashes and review statuses |
| Project adoption | [Project template](../templates/project/README.md) | Requires selected project's actual source and commands |

## Active installation audit

The v1.0.1 local installation contains 223 owned files and passes manifest
verification. No pending transaction remains; one restore point exists. The
global instruction entry is AGENTS.md with no AGENTS override sibling. The
managed guides/profiles directories contain no unaccounted files. Six generated
visual-check sidecars were removed after the compact diagram receipt was updated.
These checks do not classify unrelated Codex home contents as legacy.

## Boundaries

Archived lab records remain outside the active setup repository. Unmanaged app
state and user-modified conflicts are not broad deletion targets. A successful
manifest check does not mean every file under the user's Codex home is owned.
Abrupt process termination may leave OS temp artifacts without a journal; their
ownership cannot be inferred from a filename prefix, so they are not swept blindly.
Existing product projects and the app settings UI have not been directly verified.
No model benchmark or quantified token saving claim is part of this release.

## Paused follow-up: whole-home cleanup

The user clarified that cleanup must also examine unused global files outside
the installer manifest. The earlier release acceptance covered managed settings,
not a complete cleanup of Codex home. This wider cleanup remains incomplete.

- Read-only size inventory found approximately 20.57 GiB of logical file sizes:
  visualizations 13.41 GiB, sessions 3.47 GiB, thread history database 1.27 GiB,
  and archived sessions 1.00 GiB. Hard links/compression can change actual disk use.
- One older visualization workspace accounts for 12.55 GiB, including TripoSR,
  background-removal model weights, PyTorch/CUDA, a virtual environment and cache.
  Its contents were not deleted or confirmed dispensable.
- Two dated config backups and earlier global instruction/profile copies were
  identified as cleanup candidates; no references were found in the inspected
  active settings, guides, automations and rules.
- A command to remove those copies and stale temporary state files was rejected
  before execution with `blocked by policy`. No files were removed by that command;
  the tool supplied no more specific rejection reason.
- Current app state backups, project recovery patches, credentials, conversation
  records and plugin-managed data were preserved. Age alone does not prove disuse.

The user paused cleanup and requested this status be published. Resume by checking
current state and resolving the deletion restriction through supported controls;
do not bypass it or report whole-home cleanup as complete. This documentation-only
follow-up does not change the v1.0.1 configuration or its existing release tag.
