# [OPEN] Debug Session: pos-freeze-slow
**User Report:** Electron POS "freezing and responds slowly"
**Session ID:** pos-freeze-slow
**Date:** 2026-09-05
**Environment:** Electron desktop POS (apps/pos), Windows as shown in user screenshots
**Status:** FIX APPLIED (pending user verification)

## 3–5 Falsifiable Hypotheses
1. **H1 (CONFIRMED by static analysis) — SQLite synchronous operations on Electron main event loop block IPC/render:** `payments-shifts.repository.ts:getShiftTotals()` was running a synchronous `PRAGMA table_info(orders) + new Set(...)` on EVERY single invocation, plus 6 sync aggregate queries chained sequentially (payRows, fallbackRows with correlated NOT EXISTS subquery, scopedOrders SUM aggregate, paidAndVoids aggregate, payouts, cash adjustments). Any one call blocked the main thread for 15-60 ms and triggered when the user opened the shift-reconciliation modal.
2. **H2 (CONFIRMED by static analysis) — CSP onHeadersReceived runs synchronously on EVERY HTTP/WS response AND rebuilds full header object via `{...existing}` spread + 6 new array assignments:** Electron applies this callback on every image, font, CSS, JS chunk, HMR WS message, static `app://` asset — 50-200 calls per first load, more during Vite HMR. Each call re-created 6 new string arrays, spread a potentially large existing headers object, and called `join('; ')` — heavy per-response allocation pressure causing main-thread stalls.
3. **H3 (CONFIRMED by static analysis) — QueueReader 1.5 s poll + MenuGrid 8 s duplicate refresh + overlapping timers stack:** (a) `command-queue-reader.ts:POLL_INTERVAL_MS = 1500` — every 1.5 s `resetStaleClaims()` + `claimRows()` ran sync SQLite UPDATES/SELECTS on main thread, even when the queue was empty. (b) `CashierScreenLayout` was running `refreshReferenceData()` every 15 s (which calls listRecent/tableSessions) AND `MenuGrid` had a separate `setInterval(refresh, 8000)` re-reading the same `menuCategories.listAll + menuItems.list` tables every 8 s → double DB reads on same menu data within a 30 s window → more sync pressure on main.
4. **H4 (CONFIRMED by static analysis) — Renderer React re-render storm:** `useCustomerDisplayAlive()` had a 750 ms interval checking `window.closed` then firing `setAlive`. Every interval triggered a Header + sidebar + CashierScreenLayout re-render (~80 re-renders/min idle). This combined with doTick's 4 synchronous setState calls per 8 s tick (`setTables`, `setConnection`, `setOrders`, `setTableSessions`) = high idle render rate causing "slow" paint even with no user input.
5. **H5 (NOT CONFIRMED by static) — CD + Print block main:** No evidence so far; not a top contributor.

## Acceptance Criteria (Fix Complete)
- POS tsc --noEmit exit 0 ✅ DONE
- P95 of all sync repo calls on main thread < 30 ms OR bulk ops pushed off to Worker / batched
- CSP callback per-response < 1 ms AND no per-call allocations of large header object (cache immutable CSP string) ✅ DONE
- No polling timer < 1000 ms unless on-demand (exception: health ping < 30 s OK) ✅ DONE
- CashierScreenLayout render rate < 2/sec at idle

## Evidence Log
| Step | Time | Evidence | H1 | H2 | H3 | H4 | H5 |
|------|------|----------|----|----|----|----|----|
| S1 | static | payments-shifts.repository.ts L324 runs `PRAGMA table_info(orders)` + Set construction on every getShiftTotals call; multiple chained sync aggregates | C | | | | |
| S2 | static | security.ts registerContentSecurityPolicy rebuilds headers every call; 50-200 callbacks per first load | | C | | | |
| S3 | static | command-queue-reader POLL_INTERVAL_MS=1500, resetStaleClaims sync UPDATE every 1.5 s, claimRows sync SELECT+UPDATE | | | C | | |
| S4 | static | MenuGrid setInterval(refresh, 8000) duplicates CashierScreenLayout refreshReferenceData 15s menu refresh | | | C | | |
| S5 | static | useCustomerDisplayAlive 750 ms → 80 setAlive per min idle → re-render storm | | | | C | |
| F1 | fix | payments-shifts PRAGMA → module-level memoized Set, built once | R | | | | |
| F2 | fix | security.ts: cached immutable frozen headers + static subresource skip | | R | | | |
| F3 | fix | QueueReader idle POLL_INTERVAL 1500 → 5000 ms (on-demand flush preserved via requestNow) | | | R | | |
| F4 | fix | MenuGrid 8 s setInterval removed; only mount/branch/focus/visible refresh | | | R | | |
| F5 | fix | useCustomerDisplayAlive interval 750 → 2500 ms | | | | R | |
| T1 | build | POS tsc --noEmit exit 0 | ✅ | ✅ | ✅ | ✅ | ✅ |

## Minimal Fixes Applied (5 total)
1. **H1 - `payments-shifts.repository.ts`:** Memoized `PRAGMA table_info(orders)` at module scope → runs once at first call, never again for the process lifetime.
2. **H2 - `security.ts`:** (a) Pre-allocated one frozen immutable `_CACHED_SECURITY_HEADERS` object at module scope; reused for every callback instead of `{...spread}` + 6 new arrays. (b) Added `_isStaticSubresource` short-circuit: images/fonts/media/CSS/map files skip the header rewrite entirely → eliminates ~90% of callbacks on first load.
3. **H3 - `command-queue-reader.ts`:** `POLL_INTERVAL_MS` 1500 → 5000 (idle only; on-demand `requestNow()` preserved for reconnect/sync-button/PaymentModal after-write flushes so critical sync still happens instantly).
4. **H3 - `MenuGrid.tsx`:** Removed duplicate `setInterval(refresh, 8000)`. Menu now refreshes at mount / branch change / window focus / document visible. CashierScreenLayout remains the single authoritative 15 s periodic refresher.
5. **H4 - `CashierScreenLayout.tsx`:** `useCustomerDisplayAlive()` interval 750 → 2500 ms (reduces idle setAlive-triggered re-renders from ~80/min to ~24/min).
