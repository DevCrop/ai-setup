# Computer Use fails while writing kernel assets

## Symptom
On the Windows host, Computer Use initialization fails before any app input, on both the browser control entry point and the official native entry point:

```text
failed to write kernel assets: 지정된 경로를 찾을 수 없습니다. (os error 3)
```

A supported session reset completes, but the next initialization fails the same way.

## Cause
Unknown. The missing path has not been identified. TEMP/TMP and the resolver's Node/Python paths exist, and a user-global Node update does not fix it. A newer native skill bundle initializes on both paths.

## Fix
Fully quit and reopen the desktop app when work allows, then retry in a fresh session through the official entry point, reading the installed native skill before choosing its SDK entry point. If it still fails, use the app's official update or support route with this sanitized error and the bundle version. Do not repeatedly reset an unchanged failing kernel, and do not delete runtime assets, browser profiles or conversation databases as a speculative fix. Do not use a helper executable, a replacement UI driver or a permission bypass.

If native accessibility is null or the first screenshot does not match the selected window, activate that exact returned window and observe it again before any input.

## Check
Initialization succeeds and a small authorized UI task completes with post-action verification. Record browser and native results separately and mark only the exercised surface healthy. A browser rejection of a URL or protocol is a policy limit, not this failure, and is never bypassed.

Official setup: [Computer Use](https://learn.chatgpt.com/docs/computer-use),
[browser troubleshooting](https://learn.chatgpt.com/docs/chrome-extension).
