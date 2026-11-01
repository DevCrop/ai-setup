# agent-desktop

[agent-desktop](https://github.com/vercel-labs/agent-desktop) lets an agent read and operate apps on this PC through the Windows accessibility tree (UI Automation). It is not a remote-desktop tool: it needs the signed-in, unlocked desktop of the same PC.

## Setup on a Windows PC

```bash
npm install -g agent-desktop
agent-desktop version
```

npm may skip the install script (seen on npm 10.9.9), which leaves the slower Node launcher. Run `node scripts/postinstall.js` once inside the package folder (`npm prefix -g`, then `node_modules/agent-desktop`). The `.cmd` shim then calls the native binary; the Git Bash shim keeps the launcher, which adds about 125 ms per call.

If Codex is on the PC, move the state folder out of the user profile:

1. Set the User environment variable `AGENT_DESKTOP_HOME` to a folder outside the profile, such as `D:\PC-Storage\agent-desktop`.
2. Add the same path to `[shell_environment_policy.set]` in `~/.codex/config.toml`, when it has `[shell_environment_policy] inherit = "core"`, as this PC does, because Codex then passes only core variables to its commands.
3. Restart Claude and Codex.

Why: Codex's sandbox setup grants its sandbox users read access to folders in the profile, including `~/.agent-desktop`. agent-desktop then refuses that folder, so every snapshot fails for Claude and Codex alike.

## Codex

- Codex's sandbox runs commands as another Windows user, which cannot see the desktop. Run agent-desktop with escalated permissions.
- Call `agent-desktop.cmd`. `agent-desktop` can resolve to the npm script `agent-desktop.ps1`, which a restrictive PowerShell execution policy blocks, as seen in a `codex exec` run on this PC.

## Spending fewer tokens

One measurement on the Claude Monitor window. Sizes change with the screen it shows:

| Command | Output | Refs |
|---|---|---|
| `snapshot` | 17.4 KB | 27 |
| `snapshot -i --compact` | 8.0 KB | 27 |
| `snapshot --skeleton -i --compact` | 1.7 KB | 2 |

- Start with `--skeleton` on a dense app, then read one region with `--root <ref>`.
- Read `agent-desktop skills get desktop` (6 KB) once per task, and `skills get platform` (8 KB) only when something behaves differently.
- Pass `--window-id` when an app has several windows, as the Monitor does.

## When it fails

| Output | Cause | Fix |
|---|---|---|
| `private file DACL grants an untrusted principal` | The state folder is in the profile, or the app started before the variable was set | Follow the setup above, then restart the app |
| `EnumWindows failed` | Running inside Codex's sandbox | Run with escalated permissions |
| `about_Execution_Policies` error | PowerShell picked `agent-desktop.ps1` | Call `agent-desktop.cmd` |
| `TIMEOUT`, or only a few refs | An Electron or Chrome window is still settling, its controls sit below the depth limit, or other windows cover it (the Monitor gave few refs and `TIMEOUT` while unfocused, and all its tabs once focused) | Raise `--timeout-ms`, then try `--max-depth` or `--root`, then uncover the window and take a new snapshot |
| `PERM_DENIED` with `E_ACCESSDENIED` | The target app runs as administrator | Run the terminal as administrator, or skip that app |
| Empty or failed reads on everything | The PC is locked or a UAC prompt is open | Unlock it or answer the prompt |

Run these when it fails:

```powershell
agent-desktop.cmd status
agent-desktop.cmd list-apps
Get-Process LogonUI,consent -ErrorAction SilentlyContinue
icacls $env:AGENT_DESKTOP_HOME
Get-Content "$env:USERPROFILE\.codex\.sandbox\sandbox.$(Get-Date -Format yyyy-MM-dd).log" -Tail 20
```

`LogonUI` usually means the PC is locked or at the sign-in screen, and `consent` a UAC prompt. This is general Windows behavior, not tested here. A `Codex` line in the `icacls` output means the sandbox has reached the state folder.

## Limits

- It reads every app running as the same user, including chat apps, and snapshots store that content on disk in the state folder.
- A locked desktop, a UAC prompt and another user's session are not supported.
- Custom-drawn surfaces with no accessibility tree cannot be read. Use a screenshot there.
