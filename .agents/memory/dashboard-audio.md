---
name: Dashboard audio design
description: Architecture of CaregiverNotificationProvider — where it lives, what it owns, and the rules for when sounds play.
---

## Rule
All audio/notification state lives in `CaregiverNotificationProvider` (caregiverNotification.tsx), mounted **inside RequestStoreProvider but above WouterRouter**, so it survives internal navigation.

**Why:** AudioContext is session-scoped and destroyed on unmount. When audio state lived inside CaregiverDashboard, navigating away then back reset it and lost the pending sound queue.

## What the provider owns
- `audioCtxRef` — single AudioContext for the session
- `audioSessionReadyRef` + `audioSessionReady` state — always `false` on page load; requires one explicit click per session
- `acknowledgedIds` ref — IDs already processed (browser-notified or queued); prevents double-queuing
- `pendingSoundQueue` ref — requests that arrived while ctx was not running; only removed after chime is scheduled on a running ctx
- visibilitychange/focus handlers — drain queue when tab becomes visible

## How to apply
- `CaregiverDashboard` calls `useCaregiverNotification()` and MUST NOT recreate AudioContext or own notification effects
- `acknowledgedIds` is initialized at provider mount with all existing request IDs → old requests never replay after refresh
- A request is added to `acknowledgedIds` immediately on detection; audio queue is separate — items removed only after chime scheduled
- On focus/visibilitychange: try resume → if success drain queue (urgent first); if fail → clear sessionReady and show activation button again
- Activation button must be clicked synchronously (AudioContext created before first `await`)

## Chimes
- Normal: sine wave, 880 Hz → 1175 Hz
- Emergency: square wave, 3 bursts (660 Hz → 990 Hz), peak gain 0.50 — clearly louder and different

## Debug fields on context
`providerMounted`, `ctxState`, `sessionReady`, `pendingQueueIds`, `lastPlayedId`, `lastAudioError`
