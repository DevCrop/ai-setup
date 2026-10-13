# Container sandbox cannot write temporary files

## Symptoms and environment
Historical read-only-root Linux container, non-root UID, Codex CLI 0.154.0.

## Confirmed cause and limits
The historical sandbox attempt failed with read-only /tmp; a dedicated writable tmpfs resolved the tested invocation.

## Non-destructive diagnosis
Inspect only the owned container mount configuration and permissions. Do not make the whole root writable.

## Resolution
Provide a scoped /tmp tmpfs for the known workload while preserving network, capability and seccomp restrictions.

## Verification
Historical second codex sandbox invocation created the internal file successfully after the tmpfs change.

## Effects and rollback
Ephemeral tmpfs data is discarded with the owned container. Do not remove unrelated containers or weaken other isolation controls.

## Evidence and last review
TRACE historical inventory/S4-container-results.md. Last evidence review: 2026-09-14; no new container reproduction.

