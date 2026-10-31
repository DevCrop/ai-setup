# IPC contract: Claude Monitor

Design: `docs/arch-claude-monitor.md`. Spec: `docs/spec-claude-monitor.md`.
This file is the only definition of the channels between a renderer (strip or main window) and the main process, and of the preload API `window.monitor`. Renderer code reads this file; the preload exposes exactly the methods listed here and nothing else.

## 1. Rules for every channel

- Transport: `ipcRenderer.invoke` / `ipcMain.handle` for requests; one push channel, `status:changed`, uses `webContents.send`. No `sendSync`, no `ipcRenderer` object and no IPC event object reaches page code.
- Result envelope. Every invoke resolves, never rejects:
  - success: `{ ok: true, data: <response> }`
  - failure: `{ ok: false, error: { code: <string>, message: <fixed text>, detail?: <string> } }`
  `message` comes from a fixed table (below). `detail` exists only for `APPLY_FAILED` of fix C1 (the tail of the `apply.sh` output, max 400 chars, home folder replaced by `~`). No stack trace, no secret, no email or phone number is ever placed in an error body or in a log line.
- Payloads carry counts, states, key names, file names and the paths of Codex trust tables only. Never session text, message text, subagent descriptions or any value of a key that looks like a secret.
- Validation at the trust boundary (in `IpcRouter`, before any handler): the payload must be a plain object (or absent where the channel says "none") with no unknown keys; strings have a type, a max length and a pattern. A failure answers `BAD_REQUEST` without echoing the input.

| Field | Rule |
|---|---|
| `findingId` | string, 3 to 80 chars, `^[CXU][0-9]{1,2}:[A-Za-z0-9._-]{1,64}$`, and must exist in the current finding list or the kept fixes, else `NOT_FOUND` |
| `previewId` | string, exactly 64 chars, `^[0-9a-f]{64}$` |
| `tab` | one of `ov flow orch route tok sav set codex rt opt` |
| `notify`, `updateCheck`, `autoUpdate`, `applySetup` | boolean (`applySetup`, default true: auto-update may run `apply.sh` and `install-plugins.sh` after a pull) |
| `theme` | one of `"system"`, `"light"`, `"dark"` |
| `quietStart`, `quietEnd` | string, `""` (off) or `HH:MM` 24-hour |
| `liveSec` | one of `3`, `5`, `10` (refresh period while the main window is on screen) |
| `idleSec` | one of `10`, `30`, `60` (refresh period while only the strip shows) |
| `claudeHome`, `codexHome` | string up to 400 chars without NUL/CR/LF, `""` (automatic). `settings:set` trims and resolves a local absolute path, then requires an existing folder that holds a `projects/` folder (Claude) or a `sessions/` folder (Codex); network paths (`\\server`, `//server`) are refused. Else `BAD_FOLDER` |
| all objects | no keys other than those listed; max serialized size 1 KB |

- Who may call. `IpcRouter` maps `event.sender.id` to the window role it registered when it created the window, and also checks `event.senderFrame.url` equals that window's own page. Anything else answers `FORBIDDEN`. The monitor iframe has no preload and cannot call IPC at all.

| Channel | strip | main |
|---|---|---|
| `status:get` | yes | yes |
| `status:changed` (push) | receives | receives |
| `app:open-main` | yes | yes |
| `app:refresh` | yes | yes |
| `app:quit` | yes | yes |
| `app:strip-menu` | yes | no |
| `view:html` | no | yes |
| `findings:list` | no | yes |
| `codex:detail` | no | yes |
| `routines:detail` | no | yes |
| `history:list` | no | yes |
| `app:copy-summary` | yes | yes |
| `fix:preview` | no | yes |
| `fix:apply` | no | yes |
| `fix:restore` | no | yes |
| `settings:get` | no | yes |
| `settings:set` | no | yes |

Error codes (all channels)

| Code | Fixed message | Meaning |
|---|---|---|
| `BAD_REQUEST` | invalid request | payload failed validation |
| `FORBIDDEN` | not allowed from this window | sender role or frame not allowed for the channel |
| `NOT_FOUND` | no such finding | `findingId` unknown, or the finding has no fix |
| `NO_SNAPSHOT` | no data yet | first run has not finished |
| `INVALID_STATE` | action not allowed in this state | transition not in the table of the arch doc section 2 |
| `FIX_BUSY` | another fix is running | one fix at a time; the lock covers the whole apply/restore call, including the stale check (C1 re-runs its dry run). Also returned by preview, apply, restore and `app:quit` while an auto-update pass runs (the message text stays the same) |
| `BAD_FOLDER` | folder not found or not a Claude/Codex home | `settings:set` with a `claudeHome` / `codexHome` that fails the folder check in section 1 |
| `PREVIEW_STALE` | the target changed since the preview | recomputed `previewId` differs (for C4: live or repo `settings.json` changed); state returns to `proposed` |
| `NOT_RESTORABLE` | this fix cannot be undone here | `restorable` is false (C1) |
| `RESTORE_CONFLICT` | the file changed after the fix | the target (`config.toml` for X1/X4, repo `claude/settings.json` for C4) differs from its hash right after apply; nothing is written |
| `PREVIEW_FAILED` | preview failed | doing the preview threw |
| `APPLY_FAILED` | apply failed | doing the apply threw or `apply.sh` exited non-zero |
| `RESTORE_FAILED` | restore failed | doing the restore threw |
| `INTERNAL` | internal error | anything else; logged as key=value with the channel name and code only |

## 2. Shared shapes

```text
Result<T>   = { ok: true, data: T } | { ok: false, error: { code, message, detail? } }

Severity    = "ok" | "info" | "warn" | "bad"
SourceId    = "claude" | "codex" | "updates"
FixState    = "proposed" | "previewed" | "applying" | "applied" | "restoring" | "restored"
            | "previewFailed" | "applyFailed" | "restoreFailed"

MonitorState = "starting" | "ok" | "warn" | "bad" | "stale" | "nodata" | "error"
  first match wins:
  1. error     the last 3 runs in a row threw before producing a snapshot (checked first so a PC that never
               collects shows the error instead of "시작 중" forever)
  2. starting  no snapshot has finished yet
  3. stale     now - generatedAt > 3 x refreshSec x 1000
  4. nodata    every Claude section of the snapshot has status "missing" and the Codex source is missing
  5. bad       at least one stable finding with severity "bad"
  6. warn      at least one stable finding with severity "warn"
  7. ok

Status = {
  generatedAt:   string | null,      // ISO time of the last finished snapshot
  refreshSec:    number,             // 3 .. 86400
  state:         MonitorState,
  counts:        { warn: number, bad: number },   // stable findings by severity (seen for minAge: 3 min, C1 30 min); ok and info are not counted
  health:        number | null,      // 0..100 = 100 - 15 x bad - 5 x warn (stable counts); null when starting, stale, nodata or error
  findingsRev:   number,             // grows when the finding list or a fix state changed; refetch findings:list on change
  routing:       { ok: number, total: number },   // from summarize()
  live:          { sessions: number, agents: number },
  todayOutput:   number,             // output tokens today
  todayProjects: number,             // project folders with main or subagent messages today (activity.totals, all folders)
  todaySavedInput: number,           // today's cache reads x 0.9, input tokens not billed at full price
  cacheHit7d:    number | null,
  claudeMem:     boolean | null,
  codex:         null | {
    state:            "ok" | "warn" | "bad" | "missing",   // worst severity among the codex findings, "missing" when ~/.codex is unreadable
    model:            string | null,           // each string max 80 chars, from the allowlist of the arch doc section 6
    reasoningEffort:  string | null,
    approval:         string | null,
    sandbox:          string | null,
    plugins:          number,                  // plugin tables not set to enabled = false (Codex default is on)
    mcpServers:       number,                  // MCP tables not set to enabled = false
    trustedProjects:  number,
    missingProjects:  number,
    sessions7d:       number,                  // counted from file names or mtimes
    backups:          number,                  // config.toml.bak* files
    todayOutput:      number,                  // Codex output tokens today (usage scan), 0 when unknown
    limitPercent:     number | null            // primary usage limit as last reported, null when unknown or reset
  },
  busyFindingId: string | null       // the fix whose apply/restore call is running (its stale check included), else null
}

FindingDto = {
  id:         string,                // pattern of findingId above
  checkId:    string,                // "C1" .. "C11", "X1" .. "X8", "U1" .. "U3"
  source:     SourceId,
  severity:   Severity,
  title:      string,                // max 120, Korean
  detail:     string,                // max 400, Korean
  evidence:   string[],              // max 20 items, each max 260: counts, key names, relative paths, Codex trust-table paths
  fixable:    boolean,
  restorable: boolean,               // false when not fixable
  fixState:   FixState | null,       // null when not fixable
  recommended: boolean               // safe to apply by default (C1, X1, X4); false when not fixable
}
```

UI state mapping (spec wording): `starting` shows "시작 중", `ok` shows "정상", `warn` shows "확인 필요 N" (N = `counts.warn`), `bad` shows "문제 N" (N = `counts.bad`), `stale` shows "모니터 멈춤", `nodata` shows "데이터 없음", `error` shows the error state. "적용 중" is `busyFindingId !== null`; "적용 실패" is a finding with `fixState: "applyFailed"`; "발견 0건" is an empty `findings:list`.

## 3. Channels

### `status:get`
- Direction: renderer to main, invoke. Callers: strip, main.
- Request: none (omit the argument).
- Response: `Result<Status>`.
- Errors: `FORBIDDEN`, `INTERNAL`. Before the first snapshot the call succeeds with `state: "starting"`, `generatedAt: null` and zero counts (it never answers `NO_SNAPSHOT`).

### `status:changed` (push)
- Direction: main to renderer, `webContents.send`. Receivers: strip and main. Sent after every finished run, after every fix state change and on each tick (so `stale` shows up).
- Payload: `Status` (same shape as the `data` of `status:get`; no envelope).
- Errors: none. A renderer treats it as data and validates nothing it does not render.

### `view:html`
Decision: the monitor html is loaded as a file, not passed as a string. The file is replaced atomically on each tick, so a `srcdoc` string would keep showing old content. The sandboxed frame cannot reload itself and has no Web Storage, so the embed render drops its `location.reload()` timer, the shell reloads the frame when `status.generatedAt` changes (`src="<fileUrl>?v=<generatedAt>#<tab>"`), and the page keeps its per-session state (seen tabs, KPI history, scroll and meter values for the refresh morph) in `window.name`.
- Direction: renderer to main, invoke. Caller: main window.
- Request: none.
- Response: `Result<{ fileUrl: string, generatedAt: string }>`. `fileUrl` is the `file://` URL of `claude-monitor.html` in the app's user-data folder. The shell sets `<iframe sandbox="allow-scripts" src="<fileUrl>#<tab>">` for the seven monitor tabs (`ov flow orch route tok sav set`); changing only the `#<tab>` part switches the tab without a reload. The `codex`, `rt` and `opt` tabs are rendered by the shell itself from `status:get`, `codex:detail`, `routines:detail` and `findings:list`.
- Errors: `FORBIDDEN`, `NO_SNAPSHOT` (file not written yet), `INTERNAL`.
- The renderer can neither choose nor change the path.

### `findings:list`
- Direction: renderer to main, invoke. Caller: main window.
- Request: none.
- Response: `Result<{ generatedAt: string | null, findings: FindingDto[] }>`, max 200 findings, ordered by severity (`bad`, `warn`, `info`, `ok`), then source, then id. Includes fixes kept in `applying`, `applied`, `restoring` or a failed state even when the check no longer yields the finding.
- Errors: `FORBIDDEN`, `NO_SNAPSHOT`, `INTERNAL`.

### `codex:detail`
Added 2026-10-25 because the Codex tab showed only counts. Names, flags and counts only; never a value of a secret-looking key, never env tables, never session text (usage holds counts, folder names and model names only).
- Direction: renderer to main, invoke. Caller: main window.
- Request: none.
- Response: `Result<CodexDetail>`; errors `FORBIDDEN`, `NO_SNAPSHOT`, `INTERNAL`.

```text
CodexDetail = {
  generatedAt: string,
  state: "ok" | "warn" | "bad" | "missing",
  note: string,                                   // Korean, empty when fine
  settings: { key: string, value: string | number | boolean | null }[],   // allowlist: model, model_reasoning_effort, approval_policy,
                                                  // sandbox_mode, service_tier, approvals_reviewer, default_subagent_model,
                                                  // default_subagent_reasoning_effort, max_concurrent_threads_per_session,
                                                  // mcp_optional_startup_grace_ms (any table level where Codex puts them)
  plugins:    { name: string, marketplace: string | null, enabled: boolean }[],
  mcpServers: { name: string, enabled: boolean, transport: "command" | "url" | null, hasEnv: boolean,
                startupTimeoutSec: number | null, toolTimeoutSec: number | null }[],
  projects:   { path: string, trustLevel: string | null, exists: boolean }[],
  hooks:      { total: number, enabled: number, missing: number },  // [hooks.state.'<key>'] tables (key = <file>:<event>:n:n); missing = file part gone
  agents:     { name: string, bytes: number }[],  // ~/.codex/agents/*.toml file names, never opened
  agentsMd:   number | null,                      // bytes of ~/.codex/agents/AGENTS.md or ~/.codex/AGENTS.md
  skills:     string[],                           // directory names under ~/.codex/skills
  sessions:   { total: number, last7d: number, byDate: { [date: string]: number }, archived: number },
  logs:       { name: string, bytes: number }[],
  backups:    { name: string, bytes: number, mtime: string }[],
  worktrees:  number,                             // entries under ~/.codex/worktrees
  usage: null | {                                 // from token_count lines of sessions/**/rollout-*.jsonl, last 7 days
    days:   { date: string, input: number, cached: number, output: number }[],
    today:  { output, input, cached, sessions: number, projects: { projectName: string, sessions, output, cached, input: number, lastAt: string | null }[] },
    rate:   null | { at: string, primary: Limit, secondary: Limit | null },   // Limit = { usedPercent, windowMinutes | null, resetsAt (ms) | null }
    live:   { projectName: string, tokens: number, window: number, at: string }[],  // last request size, sessions active in 15 min
    models: { model: string, output: number }[]
  },
  findings:   string[]                            // ids of current codex findings (details via findings:list)
}
```

### `routines:detail`
Added 2026-10-31 for the 루틴 tab: Claude and Codex routines only. Report only. Executable file names only; never arguments, user names, SIDs (masked in names and paths), authors, prompts or session content.
- Direction: renderer to main, invoke. Caller: main window.
- Request: none.
- Response: `Result<RoutinesDetail>`; errors `FORBIDDEN`, `NO_SNAPSHOT`, `INTERNAL`.

```text
RoutinesDetail = {
  generatedAt: string,
  status: "ok" | "missing",                       // missing: the first collection has not finished, or it failed
  note: string,                                   // Korean, empty when fine
  collectedAt: string | null,
  claude: { name: string, description: string }[],          // ~/.claude/scheduled-tasks/*/SKILL.md front matter only
  codex:  { id: string, name: string, kind: string, status: string,   // ~/.codex/automations/*/automation.toml top keys only
            rrule: string, updatedAt: string | null }[],               // status lower case, e.g. "active"
  tasks:  { ai: "claude" | "codex", name: string, path: string, state: "ready" | "running" | "disabled" | "queued" | "unknown",
            enabled: boolean, lastRun: string | null, nextRun: string | null, lastResult: string | null,  // hex like "0x1"
            failed: boolean, triggers: string[], exe: string | null, account: "system" | "service" | "user" | null,
            elevated: boolean }[],        // Windows scheduled tasks whose name, path or command mentions claude or codex
  startup: { ai: "claude" | "codex", name: string, location: "run" | "runonce" | "folder", scope: "all" | "me",
             exe: string | null, enabled: boolean | null }[],
  windowsNote: string                             // Korean; set when not on Windows or the PowerShell read failed
}
```

### `history:list`
- Direction: renderer to main, invoke. Caller: main window. Request: none.
- Response: `Result<{ entries: HistoryEntry[] }>`, newest first, max 50, from `<userData>/fix-journal.json` (max 200 kept, atomic writes).
  `HistoryEntry = { at: string, findingId: string, checkId: string, source: SourceId, action: "applied" | "restored" | "applyFailed" | "restoreFailed", backupName: string | null, restorable: boolean, restorableAfterRestart: boolean }`.
- After an app restart, an applied X1/X4 fix whose backup file still exists comes back as `applied` and can be restored (RESTORE_CONFLICT still guarded by the hash stored right after apply). C1 and C4 are not restorable after a restart.
- Errors: `FORBIDDEN`, `INTERNAL`.

### `app:copy-summary`
- Direction: renderer to main, invoke. Callers: strip, main. Request: none. The strip menu has the same item.
- Response: `Result<{ copied: true }>`; main writes a short Korean plain-text report (state, counts, routing, tokens, Codex summary, findings, last 5 history entries; no values or secrets) to the clipboard.
- Errors: `FORBIDDEN`, `INTERNAL`.

### `fix:preview`
- Direction: renderer to main, invoke. Caller: main window.
- Request: `{ findingId: string }`.
- Response: `Result<{ findingId: string, diff: string, previewId: string, restorable: boolean }>`. `diff` is plain text (max 20 KB, truncated with a marker line): for X1 and X4 the removed table lines, for C1 the output of `bash scripts/apply.sh --dry-run`, for C4 the top-level keys that would be added to the repo `claude/settings.json` (values included; excluded: keys matching the secret regex, `env`, `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `otelHeadersHelper`, any key whose value holds such a key at any depth, keys over 80 chars and `__proto__`). Render it with `textContent`, never as HTML.
- State: `proposed`, `previewed`, `previewFailed` or `applyFailed` goes to `previewed` (a second preview issues a fresh `previewId` and voids the old one, so a reopened window can continue).
- Errors: `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`, `FIX_BUSY`, `PREVIEW_FAILED`.

### `fix:apply`
- Direction: renderer to main, invoke. Caller: main window.
- Request: `{ findingId: string, previewId: string }`. `previewId` must be the one returned by the last `fix:preview` of this finding.
- Response: `Result<{ findingId: string, fixState: "applied", restorable: boolean, backupName: string | null }>`. `backupName` is the file name only (for X1 and X4 like `20261025-103000-config.toml`), never the full path; `null` for C1.
- State: `previewed` to `applying` to `applied`.
- Errors: `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`, `FIX_BUSY`, `PREVIEW_STALE`, `APPLY_FAILED`.
- C1 runs `bash scripts/apply.sh` from the repo and nothing else; X1 and X4 write a backup before they change `config.toml`; C4 writes only the repo `claude/settings.json` atomically (never `~/.claude`, never `apply.sh`; `backupName` null), after which C1 shows the drift for the user to apply.

### `fix:restore`
- Direction: renderer to main, invoke. Caller: main window.
- Request: `{ findingId: string }`.
- Response: `Result<{ findingId: string, fixState: "restored" }>`.
- State: `applied` to `restoring` to `restored`.
- Errors: `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`, `FIX_BUSY`, `NOT_RESTORABLE` (C1), `RESTORE_CONFLICT`, `RESTORE_FAILED`.
- After an app restart X1/X4 stay restorable while their backup file exists (see `history:list`); C4 is not restorable after a restart (use git), C1 never.

### `settings:get`
Added 2026-10-31. The user's app settings from `<userData>/settings.json` (defaults when missing or broken).
- Direction: renderer to main, invoke. Caller: main window. Request: none.
- Response: `Result<Settings>`, `Settings = { notify: boolean, quietStart: string, quietEnd: string, updateCheck: boolean, autoUpdate: boolean, applySetup: boolean, theme: "system" | "light" | "dark", liveSec: 3 | 5 | 10, idleSec: 10 | 30 | 60, claudeHome: string, codexHome: string }`. Defaults: `notify: true`, quiet hours `""` (off), `updateCheck: true`, `autoUpdate: true`, `theme: "system"`, `liveSec: 5`, `idleSec: 30`, folders `""` (automatic: `CLAUDE_CONFIG_DIR` / `CODEX_HOME`, else `~/.claude` / `~/.codex`). Quiet hours apply only when both are set. A saved folder that no longer passes the folder check reads as `""`.
- Errors: `FORBIDDEN`, `INTERNAL`.

### `settings:set`
- Direction: renderer to main, invoke. Caller: main window.
- Request: any subset of `{ notify, quietStart, quietEnd, updateCheck, autoUpdate, applySetup, theme, liveSec, idleSec, claudeHome, codexHome }` (rules in section 1).
- Response: `Result<Settings>`, the whole settings after the change, written atomically. Takes effect at once: `theme` sets Electron `nativeTheme.themeSource`, so every window and the monitor frame follow it; `updateCheck: false` stops update network calls from the next run and with them the auto-updater; `autoUpdate: false` stops the auto-updater only; `notify: false` stops toasts; `liveSec` / `idleSec` set the refresh period at once (live while the main window is shown and not minimized, idle otherwise; a shorter period runs at once). A changed `claudeHome` / `codexHome` restarts the app just after the reply (new caches, sources and fix journal paths); refused with `FIX_BUSY` while a fix or an auto-update pass runs.
- Errors: `BAD_REQUEST`, `BAD_FOLDER`, `FIX_BUSY`, `FORBIDDEN`, `INTERNAL`.

### `app:open-main`
- Direction: renderer to main, invoke. Callers: strip, main.
- Request: `{ tab?: string }` or none. `tab` is one of the allowed tab ids; default `ov`.
- Response: `Result<{ opened: true }>`. Creates the Main window or focuses it and selects the tab.
- Errors: `BAD_REQUEST`, `FORBIDDEN`, `INTERNAL`.

### `app:refresh`
- Direction: renderer to main, invoke. Callers: strip, main.
- Request: none.
- Response: `Result<{ started: boolean }>`; `started: false` means a run was already in flight (calls are coalesced). The new data arrives as `status:changed`.
- Errors: `FORBIDDEN`, `INTERNAL`.

### `app:quit`
- Direction: renderer to main, invoke. Callers: strip, main.
- Request: none.
- Response: `Result<{ quitting: true }>`, sent just before `app.quit()`. Refused with `FIX_BUSY` while a fix is applying or restoring, or an auto-update pass runs.
- Errors: `FORBIDDEN`, `FIX_BUSY`.

### `app:strip-menu`
Added because the spec's right-click menu on the strip (열기, 지금 새로 읽기, 오른쪽 아래로, 끝내기) must be a native menu popped up by the main process.
- Direction: renderer to main, invoke. Caller: strip only.
- Request: none.
- Response: `Result<{ shown: true }>`. The menu items call the same main-side code as `app:open-main`, `app:refresh`, `app:quit` and the corner move, which has no channel of its own.
- Errors: `FORBIDDEN`, `INTERNAL`.

## 4. Preload API (`window.monitor`)

`preload.cjs` calls `contextBridge.exposeInMainWorld('monitor', Object.freeze({ ... }))`. Each method below calls exactly one channel; no method is added without a row here. Methods return the envelope as is (they never reject).

| Method | Channel | Returns |
|---|---|---|
| `monitor.getStatus()` | `status:get` | `Promise<Result<Status>>` |
| `monitor.onStatusChanged(callback)` | `status:changed` | `() => void` (call it to unsubscribe); `callback` gets one argument, the `Status` object, never the IPC event |
| `monitor.getViewHtml()` | `view:html` | `Promise<Result<{ fileUrl, generatedAt }>>` |
| `monitor.listFindings()` | `findings:list` | `Promise<Result<{ generatedAt, findings }>>` |
| `monitor.getCodexDetail()` | `codex:detail` | `Promise<Result<CodexDetail>>` |
| `monitor.getRoutines()` | `routines:detail` | `Promise<Result<RoutinesDetail>>` |
| `monitor.listHistory()` | `history:list` | `Promise<Result<{ entries }>>` |
| `monitor.copySummary()` | `app:copy-summary` | `Promise<Result<{ copied }>>` |
| `monitor.previewFix(findingId)` | `fix:preview` | `Promise<Result<{ findingId, diff, previewId, restorable }>>` |
| `monitor.applyFix(findingId, previewId)` | `fix:apply` | `Promise<Result<{ findingId, fixState, restorable, backupName }>>` |
| `monitor.restoreFix(findingId)` | `fix:restore` | `Promise<Result<{ findingId, fixState }>>` |
| `monitor.openMain(tab)` | `app:open-main` | `Promise<Result<{ opened }>>`; `tab` optional |
| `monitor.refresh()` | `app:refresh` | `Promise<Result<{ started }>>` |
| `monitor.quit()` | `app:quit` | `Promise<Result<{ quitting }>>` |
| `monitor.showStripMenu()` | `app:strip-menu` | `Promise<Result<{ shown }>>` |
| `monitor.getSettings()` | `settings:get` | `Promise<Result<Settings>>` |
| `monitor.setSettings(patch)` | `settings:set` | `Promise<Result<Settings>>`; `patch` is passed as the request object |

The 17 methods map one to one to the 17 channels (16 invoke channels and the `status:changed` push). The preload packs the arguments into the request objects above (`{ findingId }`, `{ findingId, previewId }`, `{ tab }`) and does no other logic. The strip and the Main window load the same preload; the main process, not the preload, decides which window may call what.

## 5. Contract tests

`app/test/ipc-router.test.mjs` uses a fake `ipcMain` and a fake `senderRole`:
- every channel of the table in section 1 answers `FORBIDDEN` from a role that is not allowed;
- a payload with an unknown key, a wrong type, a too long string or a bad pattern answers `BAD_REQUEST` and the handler is not called;
- a handler that throws yields `INTERNAL` with the fixed message and no stack;
- the keys of the preload object, read from `preload.cjs` source, equal the method column of section 4, and the channel strings used by the preload equal the channel column (a static check, no Electron needed).
