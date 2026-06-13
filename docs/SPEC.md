# Live Poker Tracker — Build Spec

**Target:** Installable PWA, optimized for Pixel 9 Pro (Chrome/Android), one-handed thumb use at the table. Local-first storage (IndexedDB) — works with zero signal in a casino. No accounts, no backend required for MVP.

---

## 1. Core Concepts

Three entities: **Session**, **Buy-in Event**, **Hand**.

### Session
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| status | enum | `active` / `completed` |
| date | date | Auto from start time |
| venue | string | Picker with recent venues + free text |
| game | enum | NLHE default; PLO, mixed, other |
| stakes | string | e.g. "2/5", picker with recents |
| start_time | datetime | Set on "Start Session" |
| end_time | datetime | Set on "End Session" |
| cash_out | number | Entered at session end |
| table_notes | text | Lineup reads, table dynamics |
| condition_tags | tags | sleep, energy, tilt, A-game/B-game/C-game |
| expenses | number | Tips, meals, travel (optional, tax-relevant) |

Computed per session: total buy-in (sum of buy-in events), net result, duration, $/hr.

The session log doubles as the contemporaneous record a professional needs for tax documentation — date, venue, game, stakes, in/out are all here by design.

### Buy-in Event (child of Session)
amount, timestamp. "Rebuy" is a one-tap button during an active session that opens a number pad pre-filled with the last buy-in amount.

### Hand (child of Session)
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| session_id | fk | |
| timestamp | datetime | Auto |
| capture_type | enum | `voice` / `text` |
| audio_blob | blob ref | voice only; webm/opus in IndexedDB |
| transcription | text | filled later (Phase 3), editable |
| position | enum | UTG…BTN, SB, BB (chip selector) |
| eff_stack | number | in BB or $, toggle |
| action_line | text | shorthand, e.g. "co open 15, btn 3b 45, h call, flop K72r x/c 35..." |
| villain_notes | text | reads |
| result | number | +/- $ |
| tags | tags | 3bet-pot, bluff-catch, cooler, review, etc. |
| review_status | enum | `raw` / `reviewed` |

Voice hands need only: tap, talk, tap. Everything else is optional and fillable post-session.

---

## 2. Screens & Input Flow

### Home (no active session)
- Big **Start Session** button → venue/stakes/buy-in quick form (3 fields, recents pre-filled) → session live.
- Below: stats summary cards + recent sessions list.

### Active Session (the screen that matters)
Persistent header: venue, stakes, running timer, current total buy-in.

Three giant thumb-zone buttons:
1. **🎤 Voice Hand** — tap to record, tap to stop. Saves blob with timestamp. Zero other input required. Show recording time and a pulsing indicator.
2. **⌨️ Quick Hand** — structured form: position chips (one tap), stack presets/stepper, action shorthand text field (autocapitalize off, autocorrect OFF), result number pad, optional tags. Target: loggable in under 30 seconds.
3. **Rebuy** — number pad, default = last buy-in.

Footer: **End Session** → cash-out number pad → optional notes/condition tags → summary card (net, duration, $/hr).

Important real-world constraint: most card rooms prohibit recording devices at the table. Voice capture is designed for *away from the table* — walking to the bathroom, break, parking lot. Quick Hand (text) is the at-table tool; it looks like texting. Note this in the app's empty-state copy as a self-reminder.

### Hand Review (post-session)
List of hands filtered by `review_status = raw`, grouped by session. Voice hands: inline audio player + transcription field. Mark reviewed when processed. This is the bridge to study workflow.

### Stats Dashboard
- Lifetime + filterable by date range, venue, stakes, game.
- $/hr, total hours, total net, win rate by session, std dev, biggest win/loss.
- Cumulative results line chart; results-by-stake and results-by-venue tables.
- Hands flagged `review` count as a to-do indicator.

---

## 3. Technical Decisions

- **Stack:** Single-page PWA. React or vanilla — builder's choice. Service worker for offline + installability. All assets cached.
- **Storage:** IndexedDB (use `idb` or Dexie). Audio stored as opus/webm blobs (~1 MB/min — hundreds of voice memos before storage matters). Request persistent storage (`navigator.storage.persist()`) so Chrome doesn't evict.
- **Voice:** MediaRecorder API (fully supported Chrome/Android). No streaming, no server.
- **Hosting:** Any static host (GitHub Pages / Vercel free tier). The app is fully client-side; the host just serves files.
- **Backup/Export (non-negotiable):** One-tap export of all data as JSON (including audio as separate files in a zip) + CSV export of sessions and hands. Local-first means the phone is the single point of failure until exported — surface a "last backup" timestamp on the home screen.

---

## 4. Build Phases

**Phase 1 — MVP (one sitting):** Sessions + buy-ins + end-of-session flow, stats dashboard, Quick Hand text capture, JSON/CSV export, installable PWA.

**Phase 2 — Voice:** MediaRecorder capture, audio storage, playback in Hand Review.

**Phase 3 — Transcription:** Pipe voice hands through transcription (Claude API from a companion script, or local Whisper later) → fills `transcription` field → structured fields extracted for review. Run post-session on desktop; phone never needs to do this.

**Phase 4 — Integration:** Scheduled/manual sync of sessions CSV to Google Drive so the existing daily-briefing automation can read poker results alongside the portfolio tracker.

---

## 5. Acceptance Tests (use these to verify the build)

1. Airplane mode on: start session, log 2 text hands, record 1 voice hand, rebuy, end session — everything persists after force-closing Chrome.
2. Voice hand captured in exactly 2 taps from the active session screen.
3. Quick Hand loggable one-handed in under 30 seconds.
4. Install to home screen; launches full-screen without browser chrome.
5. Export produces a zip restorable via an Import function (round-trip test).
6. Dashboard $/hr matches hand-calculated value for 3 seed sessions.
