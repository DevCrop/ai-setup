# Troubleshooting index

Historical observations are version-scoped. Diagnose before applying a workaround. Do not store device codes, authorization URLs containing parameters, tokens or auth files.

| Symptom | Record |
|---|---|
| Relative script path not found | [Shell location](incident-01-relative-path.md) |
| codex.exe not found | [CLI discovery](incident-02-cli-path.md) |
| Container device request transport failure | [CA bundle](incident-03-container-ca.md) |
| Device login disabled | [Account setting](incident-04-device-auth-disabled.md) |
| Browser says success; terminal unchanged | [Login status](incident-05-browser-terminal.md) |
| Requested workspace-write renders read-only | [Windows sandbox](incident-06-windows-sandbox.md) |
| Container temporary-path write failure | [Container tmpfs](incident-07-container-tmp.md) |

Evidence identifiers refer to preserved TRACE Lab historical documents, not runtime dependencies of this setup. These records summarize those documents without copying raw authentication or run outputs.
