---
name: Dashboard audio design
description: How the CaregiverDashboard AudioContext is managed — the decisions that were hard-won through multiple failed iterations.
---

## The rule
`AudioContext` lives in `audioCtxRef` (a React `useRef`), not a module-level variable. Module-level vars survive HMR but reset on a real page reload, which silently breaks audio on published HTTPS builds where the banner is hidden.

**Why:** Module-level `_audioCtx = null` resets every page load. If localStorage says audio is enabled, the old code hid the banner — so `resume()` was called without a gesture when a notification arrived, which browsers reject.

## How to apply
- Create `AudioContext` inside a synchronous click handler only. Never outside a gesture.
- `audioActiveRef` (not state) tracks whether the context is running this session — used inside notification `useEffect` to decide whether to call `playChime`.
- Banner: only shown when `localStorage.getItem(CAREGIVER_AUDIO_KEY) !== 'true'` (never-enabled users). Use key `sameyba_caregiver_audio_v2` — old key `sameyba_audio_unlocked_v1` stored `'1'` (not `'true'`) and caused stale reads.
- Returning users (localStorage `=== 'true'`): add a one-shot `document.addEventListener('click', ..., { once: true })` effect that creates + resumes ctx on their first click anywhere. No banner shown; if resume() fails, clear localStorage so banner shows next load.
- Visibility/focus handler: resume the *existing* ctx if suspended. Never recreate it without a gesture.
- No heartbeat interval — the visibility handler is sufficient.

## Chime spec
- Tone 1: 880 Hz, 180 ms, peak gain 0.28
- Tone 2: 1175 Hz, 220 ms, peak gain 0.24 (starts at +0.22 s offset)
- Function: `playChime(ctx: AudioContext)` — uses `ctx.currentTime` offsets so it works even if ctx.currentTime was frozen during suspension.
