# machine/ data contract

Shared between `scan.mjs` (scanner + detectors), `page.mjs` (treemap HTML) and `clean.mjs` (cleaner).
Node 22, ESM `.mjs`, zero dependencies, Windows 10 first (paths may use `\`). Tests: `node --test "machine/**/*.test.mjs"`.

## Files and owners

| File | Owner |
|---|---|
| `scan.mjs`, `lib/walk.mjs`, `lib/detectors.mjs`, `test/walk.test.mjs`, `test/detectors.test.mjs` | scanner |
| `page.mjs`, `test/page.test.mjs`, `test/fixtures/sample-scan.json` | page |
| `clean.mjs`, `lib/deny.mjs`, `test/clean.test.mjs`, `test/fixtures/sample-plan.json` | cleaner |

`scan.mjs` calls `renderPage(data)` from `./page.mjs`, writes the string to `path.join(os.tmpdir(), 'machine-map.html')` and prints that path.

## Scan data (`renderPage(data)` input)

```js
{
  version: 1,
  generatedAt: "2026-10-19T12:00:00.000Z",
  host: "DESKTOP-X",
  durationMs: 41234,
  roots: [{ path: "C:\\", total: 512e9, free: 100e9 }],   // total/free from fs.statfs, null if unknown
  skipped: { unreadable: 1234, reparse: 56 },            // counts only
  tree: Node,                                            // synthetic root "PC" whose children are the roots
  junk: [Junk]
}
```

`Node` (short keys keep the HTML small):

```js
{ n: "Users", p: "C:\\Users", s: 123456789, m: 1760000000000, c: [Node], j: [0, 3] }
```

- `n` name, `p` absolute path, `s` total bytes (logical file size, sum of subtree), `m` latest mtime in ms of anything in the subtree.
- `c` children sorted by `s` desc; omitted on leaves and below the depth limit.
- Depth limit 5 below each root. Paths of junk candidates are kept at full depth (their ancestors too).
- Per node keep the children that are ≥ 0.1% of that root's size, at most 40; the rest merge into one child `{ n: "(기타 N개)", p: null, s, m }`.
- Files are not nodes; a folder's own files count only in its `s`.
- `j` optional: indexes into `junk` whose `path` equals this node's `p`.

`Junk`:

```js
{
  id: "npm-cache:C:\\Users\\me\\AppData\\Local\\npm-cache",  // category + ":" + path, unique
  category: "pkg-cache",          // see table
  tool: "npm",                    // pkg-cache only: npm|pnpm|yarn|pip|uv|bun|nuget|gradle
  label: "npm 캐시",               // short Korean
  path: "C:\\Users\\me\\AppData\\Local\\npm-cache",
  size: 1234567,
  mtime: 1760000000000,
  score: 0.9,                     // 0..1 how sure it is safe to reclaim; drives color
  reason: "npm이 다시 받을 수 있는 다운로드 캐시입니다.",   // Korean, why it is junk
  how: "npm cache clean --force",                          // Korean or command, the safe way
  action: "command",              // recycle | command | report  (what clean.mjs will do)
  safety: "safe",                 // safe | check | manual  (see below)
  effect: "다음에 패키지를 설치할 때 인터넷에서 다시 받습니다. 그 외 영향 없음."   // Korean: what happens after deleting
}
```

`safety` tiers (shown as groups in the page; the "자동 최적화" button ticks exactly the `safe` ones whose action is not `report`):

- `safe` 삭제해도 됨 — the program rebuilds or re-downloads it by itself; worst case is a slower first run. Default for temp, pkg-cache, crash-dump, browser-cache, shader-cache, app-cache, plugin-cache.
- `check` 확인 후 삭제 — reclaimable but the user should glance at it: dev-artifact (needs reinstall to run that project again), orphan-worktree.
- `manual` 직접 판단 — report-only or guessy: appdata-orphan, recycle-bin, vm-disk, system-cleanup, old-download, and anything inside a protected (deny-listed) folder.

## Categories (clean.mjs decides the real action from `category`/`tool`; it never runs a command string from the plan)

| category | what | action | score |
|---|---|---|---|
| `temp` | `%TEMP%` (`os.tmpdir()`, here `D:\PC-Storage\Temp`), `C:\Windows\Temp` | recycle each child older than 1 day, skip locked/denied; never `<tmp>\claude` (live Claude sessions) or `machine-map.html` | 0.9 |
| `pkg-cache` | npm, pnpm, yarn, pip, uv, bun, NuGet, Gradle caches | command per tool (gradle: recycle `~/.gradle/caches`) | 0.9 |
| `dev-artifact` | `node_modules`, `.venv`/`venv`, `dist`/`build`/`.next`/`target` in a project (has `package.json`/`pyproject.toml`/`Cargo.toml`/`.git`) whose newest source mtime is 90+ days old | recycle | 0.8 |
| `orphan-worktree` | (a) dir whose `.git` file points to a gitdir that is missing, or whose parent repo's `git worktree list --porcelain` does not list it → recycle dir; (b) worktree the parent lists whose HEAD is an ancestor of the parent's default branch (`git merge-base --is-ancestor`), with a clean `git status --porcelain`, outside the parent's own `.claude/worktrees/` → `git worktree remove <path>` run in the parent (refuses if dirty); (c) parent entries marked `prunable` → `git worktree prune` in the parent. Example (b): `C:\Users\edn_y\orca\workspaces\ai-setup\arrowworm`, parent `D:\project\ai-setup` | see left | 0.7 |
| `plugin-cache` | `~/.claude/plugins/cache/<market>/<plugin>/<version>` not referenced by `~/.claude/plugins/installed_plugins.json` | recycle | 0.8 |
| `appdata-orphan` | `%APPDATA%`/`%LOCALAPPDATA%` folder ≥ 50 MB, untouched 180+ days, matching no installed app in the uninstall registry (HKLM/HKCU, 32/64-bit, `reg query`, read-only) | recycle | 0.4 |
| `recycle-bin` | `X:\$Recycle.Bin` per drive | report (empty it from Windows yourself) | 0.6 |
| `crash-dump` | `%LOCALAPPDATA%\CrashDumps`, `C:\Windows\Minidump`, `*.dmp` under `%LOCALAPPDATA%` | recycle | 0.9 |
| `vm-disk` | Docker/WSL `*.vhdx` | report | 0.2 |
| `browser-cache` | Chrome/Edge/Brave/Firefox `Cache`, `Code Cache`, `GPUCache`, `cache2` | recycle (skip locked) | 0.8 |
| `shader-cache` | `%LOCALAPPDATA%\D3DSCache`, `%LOCALAPPDATA%\NVIDIA\DXCache`, `…\NVIDIA\GLCache`, `%LOCALAPPDATA%\AMD\DxCache` | recycle children (skip locked) | 0.85 |
| `app-cache` | Electron/desktop app caches under `%APPDATA%\<app>\{Cache,Code Cache,GPUCache,CachedData}` (Discord, Slack, Teams, Code, Cursor, Notion, Spotify…), `%LOCALAPPDATA%\Microsoft\Windows\INetCache`, `%LOCALAPPDATA%\Microsoft\Windows\WER` (error reports) | recycle children (skip locked) | 0.8 |
| `system-cleanup` | `C:\Windows\SoftwareDistribution\Download`, `C:\Windows\Logs\CBS`, Delivery Optimization (`C:\Windows\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization`) — size if readable | report: "Windows 디스크 정리(cleanmgr) → 시스템 파일 정리" (needs admin) | 0.5 |
| `ai-old-version` | old versions of AI tools and editor extensions; keep the newest per group: `~/.local/share/claude/versions/<v>` (Claude Code CLI), `%APPDATA%\Claude\claude-code\<v>` (Claude desktop's bundled CLI), `~/.vscode/extensions/<id>-<ver>[-win32-x64]` and `~/.cursor/extensions/…` (group by id, keep highest version) | recycle | 0.85 safe |
| `ai-temp` | AI tool temp/cache, one item per ROOT (like `temp`; the cleaner recycles the qualifying children and exempts the root itself from the deny check): `~/.codex/.tmp` and `~/.codex/cache` children ≥1 day (safe); `~/.claude/plugins/.trash` children (safe); old Claude Code session scratch `<tmp>\claude\<dir>` untouched ≥14 days (check; never the dir of the current working directory's session) | recycle children | 0.7–0.9 |
| `editor-state` | `%APPDATA%\{Code,Cursor}\User\workspaceStorage` children untouched ≥90 days — they hold per-project AI chat history, so report only | report | 0.3 manual |
| `ai-history` | report only: `~/.codex/sessions`, `~/.codex/archived_sessions`, `~/.claude/projects` (conversation history), Cursor/Code `User\globalStorage` ≥1 GB, `~/.codex/.sandbox-recovery` (Codex runtime rollback backup), npm-global `@anthropic-ai/claude-code` when the native Claude Code install also exists (`npm uninstall -g @anthropic-ai/claude-code`) | report | 0.2 manual |

Codex worktrees under `~/.codex/worktrees` are never touched while anything in them changed in the last 14 days (`CODEX_WT_MIN_IDLE_DAYS`, both sides). `ai-old-version` never picks the running `claude --version` or the extension version listed in the editor's `extensions/extensions.json`.
| `old-download` | files in `~/Downloads` ≥ 100 MB untouched 90+ days, esp. `.exe .msi .zip .iso .7z` installers/archives (one junk per file) | report (Downloads is protected; user deletes by hand) | 0.3 |

## Plan JSON (page exports, clean.mjs reads)

```js
{ version: 1, createdAt: "…", items: [{ id, category, tool, path, size }] }
```

`clean.mjs` treats the plan as untrusted: it re-checks each item against the deny list, re-measures it, and maps `category`/`tool` to its own fixed actions.

## Content reads

Test fixtures named `.env*`, `.credentials*` or `*credentials*.json` are created at runtime in `fs.mkdtemp`, never committed (`.gitignore` drops them).

Sizes and mtimes only. The only files whose content is read: `~/.claude/plugins/installed_plugins.json`, a worktree's `.git` pointer file (one `gitdir:` line), and `~/.vscode/extensions/extensions.json` / `~/.cursor/extensions/extensions.json` (which extension versions are active). Never open `.credentials*` or `.env*`.
