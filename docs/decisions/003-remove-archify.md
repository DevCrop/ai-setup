# Decision 003: Archify removed

Approved by the user on 2026-10-13. TRACE sets up Ponytail and RTK only. Archify is no longer a required or bundled tool; this supersedes the Archify part of Decision 001 ("Archify and Ponytail are required tools") and the Archify rows of Decision 002.

Removed: `vendor/archify`, its manifest, lock, registry and retirement entries, its invocation policy, the Archify-rendered `diagrams/global` flow and its receipt check in `validate_repo.py`, and Archify text in the global agreement, guides, templates and current docs. Release notes, verification records and handoffs stay as history.

On a host that had Archify installed, `setup.py plan` removes the TRACE-owned unchanged copies; modified or unowned copies under the personal skill root are left for the user to delete.
