# Ownership and package deployment

The manifest owns global policy files, profiles, and every file in the reviewed
Ponytail distribution. Bundled originals are pinned with per-file SHA-256
in versions.lock.json. Keeping complete originals makes offline installation and
transactional removal reproducible; package contents are not automatically loaded
as prompt context.

There is no separate bootstrap helper; setup.py is the only install and update
path, so every install takes part in transactional updates, removal and rollback
under the same ownership contract.

Entries under `retired` in manifest.json (superseded personal skills and two
fingerprinted config backup files) are removed only when their SHA-256 matches; their
prior bytes stay only in the local restore point. Other app state and backups are not
owned and are never broadly deleted.

Global configuration is not an app-version lock. The installed CLI is not silently
upgraded. Remote model availability may differ from its bundled catalog.
User-selected base model and reasoning settings are preserved.
