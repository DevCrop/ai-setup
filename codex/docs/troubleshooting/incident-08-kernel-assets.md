# Computer Use fails while writing kernel assets

Observed 2026-10-08 on the Windows host, before user JavaScript or any app input:

```text
failed to write kernel assets: 지정된 경로를 찾을 수 없습니다. (os error 3)
```

The browser control entry point and the installed official native Computer Use
initialization both returned this error. Their supported session resets completed,
but the next initialization failed identically. This is an observed initialization
incident; the exact missing path and root cause have not been established.

Existing TEMP/TMP directories and the dependency resolver's Node/Python paths were
present. The official installed native skill was read before selecting its SDK
entry point. No helper executable, replacement UI driver or permission bypass was
used. The separate user-global Node update does not prove an app-owned kernel fix.

For a future recurrence, a useful state change is to fully quit and reopen the desktop app when ongoing work
allows, then retry in a fresh session using the official entry point. If it still
fails, use the app's official update/support route with this sanitized error and
version evidence. Do not repeatedly reset an unchanged failing kernel or delete
runtime assets, browser profiles or conversation databases as a speculative fix.

Resolution requires initialization plus an actual small authorized UI task and
post-action verification. Record browser and native results separately. Mark only
the successfully exercised surface healthy; keep the other unknown or failed.

Official setup: [Computer Use](https://learn.chatgpt.com/docs/computer-use),
[browser troubleshooting](https://learn.chatgpt.com/docs/chrome-extension).

## Resolution verification — 2026-10-08

The later session exposed native skill bundle 26.1002.52244 instead of
26.930.61225. Official initialization then succeeded on both native and browser
paths. Calculator input/result/restoration and public documentation link navigation
were observed directly; see the [verification record](../verification-computer-use.md).
The root cause and reason for recovery remain unknown; do not attribute this to
the separate Node update or assume every initialization error shares this cause.

Native accessibility was null and an initial screenshot did not match the selected
window. Activating that exact returned window and observing it again recovered the
correct view before input. The personal recovery reference captures this bounded
response. The browser's separate file-protocol rejection is a policy limitation,
not a recurrence of the kernel-assets failure and not permission to bypass it.
