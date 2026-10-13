# Focused recovery

## Built-in browser and Chrome

Use the current official browser-control API. Bind an explicit tab mention or
requested browser/profile before considering defaults. Local web previews normally
use the built-in browser; existing signed-in workflows use the requested Chrome
profile. Do not migrate sessions or silently switch surfaces after failure.

Reuse a live browser/tab binding. Name Chrome work through the supported session
option and open a separate task tab when no existing user tab is required. Keep
research/check tabs temporary; preserve requested deliverables or pending handoffs.
Never close unrelated user tabs. No fixed project path or browser binary is needed.

Use the cheapest fresh observation that answers the next question: current semantic
controls for actions, a scoped heading/value for result checks, and screenshots for
visual questions. Avoid repeated full-page captures and same-URL navigation. Batch
only deterministic supported actions, then observe before choosing the next action.
Navigation can complete after an input returns: confirm the destination's visible
state before reading its URL as final evidence. Do not guess selectors or retain
stale element indexes. An unknown submission result requires observation, not replay.

For connection failure, check the selected surface/profile and official browser
troubleshooting. A blocked site/protocol is distinct from a missing extension,
stale tab, disconnected host or page failure. Keep bounded recovery on that same
surface; request only the required user setup when official recovery cannot finish.
Do not auto-enable all-site access, full CDP, file-URL access or other permissions.
Record sanitized surface, stage, error signature, first/last occurrence, available
runtime identity, attempted recovery, result and next check in the existing private
ledger. Unknown version fields remain unknown; do not inspect private browser
profiles or browsing history merely to populate an error report.

## Failure routing

| Observed stage | Next useful evidence/action | Completion evidence |
|---|---|---|
| Kernel/assets fail before user code | Record exact error signature; check the official runtime dependency resolver and whether documented host paths exist. A supported session reset can establish fresh evidence. Do not reinstall arbitrary npm packages or launch helper binaries. | Official initialization succeeds, followed by a small authorized UI operation. |
| Browser extension not connected | Follow the current extension setup/troubleshooting page; check the chosen profile and browser's Manage state. Any app/browser permission UI is handled under the official permission rules. | Selected browser can observe the intended tab and complete the scoped check. |
| Native surface disabled or not exposed | Keep browser/native results separate. Confirm installed plugin capability and required user setup. Do not infer that installing a skill enables the runtime. | Native surface returns an actual target and permits the authorized operation. |
| Accessibility result is null or incomplete | Check optional fields before reading a tree. Use the official screenshot observation when the app exposes no usable accessibility data. | The intended control is visible in a current target-matching screenshot. |
| Screenshot does not match the selected window | Do not input into that image. Activate the returned target using the official API and observe again; stop if the mismatch persists. | Screenshot content and selected app/window agree before any input. |
| Browser rejects a URL or protocol | Treat the rejection as a policy boundary. Do not proxy, rehost or switch drivers to reach the same blocked content. An unrelated public page can test general browser health, but cannot validate the blocked page. | The permitted task succeeds, or the exact inaccessible target remains unverified. |
| Stale window/tab, missing element, unexpected modal | Re-select the returned target and observe again. Follow the official runtime's bounded recovery; never replay old coordinates. | Current target, correct focus, expected post-action state. |
| Action timeout / interrupted turn | Treat outcome as unknown. Observe before any repeat; stop input if the user ended control. | Actual application result, including absence of duplicate submission. |
| Wrong application or locked Windows desktop | Stop input. Ask only for the required target/unlock action. | Correct visible target on the active unlocked desktop. |

A repeated identical initialization failure is a runtime/setup incident, not proof
that more workflow instructions will repair it. Keep the goal incomplete until
the blocked surface is exercised successfully. Suggest app restart/update only
when evidence supports that next step; do not claim that it already fixes the issue.

For local rendering checks, preserve the user's project root and server lifecycle.
Discover a real task-owned server handle and URL before browsing. An expired
observation does not prove that its process stopped. Close only task-created test
tabs/processes after acceptance. Do not alter other projects or browser sessions.

Official setup/troubleshooting: [Computer Use](https://learn.chatgpt.com/docs/computer-use)
and [browser extension](https://learn.chatgpt.com/docs/chrome-extension).
