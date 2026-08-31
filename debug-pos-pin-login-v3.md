# POS PIN Login Debug Session v3 (pos-pin-login-v3)

- **Status**: [OPEN]
- **Session ID**: pos-pin-login-v3
- **Created**: 2026-08-31
- **Bug Symptom**: User reports "its not working" immediately after controlled-browser E2E showed Admin-reset PIN 7746 → successful login to #/pos with "I Igwe Klal WAITER". The user's environment differs in some way from the controlled integrated_browser view. Need to capture runtime evidence from the USER'S actual attempt, not our isolated one.
- **Expected**: Admin "Reset PIN" in Admin employees page → raw 4-digit PIN shown to admin → user/cashier enters those 4 digits into actual real Browser POS LoginScreen → navigates to #/pos CashierScreenLayout with employee banner, no "Incorrect PIN" error.
- **Prior v1/v2 applied fixes still in codebase**:
  1. SERVER: `EmployeeStatus` enum + Employee interface (`@prolific/shared-types` both copies), `employee.schema.ts` status @Prop default ACTIVE indexed, `auth.service.ts` Phase1+Phase2 `$or` belt+suspenders for legacy docs missing status.
  2. BROWSER POS UI: LoginScreen catch block defensive guard (re-raise 401/Invalid PIN so they don't fall to SEEDED shim), mock-electron-shim findByPin remote HTTP first then SEEDED fallback.
  3. SHARED UTILS: `tryGetNodeCreateHash()` on-demand pattern so `@prolific/utils` loads cleanly in browser without top-level crypto import blowing up; POS vite.config.ts resolve.alias to shared package TS sources (not CJS dist).
  4. MONGO backfill: `db.employees.updateMany({$or:[{status:{$exists:false}},{status:null}]},{$set:{status:'ACTIVE'}})` — 15 docs updated v2.
  5. UI DEMO HINTS: All 1234/0000/9999/demo PIN text removed from LoginScreen per prior user req.

## 3–5 Falsifiable Hypotheses (THIS session only — must be confirmed/rejected via runtime evidence from USER'S actual attempt)

### H1: User is hitting a DIFFERENT backend server URL than :4000 (Render remote? Or wrong API_BASE path)
- Controlled-browser view used `localhost:4000` (live server HTTP200). User may be on Render URL (cold start resilience layer intercepts but maybe their browser hits a different origin or the remote Render is still on the OLD code without v1+v2 status/schema fixes → backend query still returns 0 candidates).
- Observation points: POS remote-auth.ts `pinLogin()` fetch URL; network panel final POST target URL; what server responds (status code, body).

### H2: User is running an OLDER compiled POS bundle (stale JS from before v2 LoginScreen/mock-electron-shim fixes took effect)
- User's own tab/process may not be on the freshly restarted `BROWSER_ONLY=1 npm run dev` that integrated_browser view uses. May have a separate manually-started POS that's stale. Or cached bundle from before the findByPin+catch edits.
- Observation points: Browser sources in user's tab; do the edits (catch re-raise regex, shim findByPin HTTP call) actually appear in their runtime JS?

### H3: Admin "Reset PIN" returns a rawPin but the browser LoginScreen input normalizes the digits differently (extra whitespace? type coercion? String vs number? PinPad onClick sends string vs number to state?)
- E.g., Admin returns `7746` as `String | Number` differently; or user's browser POS PIN pad clicks append to a number state instead of string, leading leading zeros stripped (if PIN is e.g. 0037 then state becomes 37 → 3 digits → Sign In stays disabled OR bcrypt compare wrong length).
- Observation points: Reset PIN rawPin typeof + len on Admin side; POS LoginScreen pin state typeof + len on every PIN pad press; final POST body pin value sent to /auth/pin/login.

### H4: Post-v1 backfill server bytecode stale (Nest watcher didn't pickup v2 backfill update queries or schema changes) OR Render remote still on OLD commit → status query still returns 0
- If user's browser is hitting Render remote (`prolific-api.onrender.com` or whatever the production URL is), not local :4000. Render deploy only had commit ba7474b (pre v1+v2 PIN fixes). The local server :4000 we have running has the fixes, but if user's POS is configured to hit Render remote they get the old backend.
- Observation points: Check window API base used by POS for pinLogin POST; remote-auth.ts actual fetch URL; check server code version (has Phase2 $or filter? Or old {status:'ACTIVE'} only?).

### H5: User actually got an "Incorrect PIN" from explicit credential rejection (NOT a network fallback) — meaning the server-side hash/pin roundtrip itself IS broken for their specific PIN/employee combo, but our automated simulator test passed for a DIFFERENT employee
- Our simulator in v2 reset PIN for employee "Igwe Klal" (1st non-seeded) and it worked. User might be resetting a DIFFERENT specific employee (e.g., one that doesn't have a pinHash field at all in Mongo, or weird role/branch filtering edge case in Phase1 that Phase2 catches differently in their case).
- Observation points: Server pin/login controller entry H4 log; auth.service Phase1 candidate count + Phase2 candidate count + per-candidate bcrypt compare result for THEIR pin attempt.

## Log Plan
- Session ID: `pos-pin-login-v3`
- Log file: `trae-debug-log-pos-pin-login-v3.ndjson`
- Debug point IDs (H1..H6):
  - H1_ADMIN_RESET_URL: Admin employees page right after res.response returns → report resetPin URL origin + branch being used.
  - H2_POS_PINLOGIN_TARGET: POS remote-auth.ts pinLogin prefetch → report final fetch URL (hostname, port, path), pin typeof + pinLen
  - H3_PINPAD_STATE: LoginScreen every PIN pad click append → report (pinState: string, len: N, typeof, SignIn enabled?)
  - H4_PINLOGIN_ENTRY: auth.controller POST /pin/login entry → report pinType, pinLen, headers X-Forwarded-For / origin to identify which server user hit. (Re-add existing H4 from v2 if still present)
  - H5_AUTH_CANDIDATES: auth.service loginWithPin Phase1 candidates[] + Phase2 candidates[] enumeration + per-candidate statusRaw + bcrypt compare pass/fail. (Re-add v2 H2/H3)
  - H6_BROWSER_FINAL_ERROR: LoginScreen submitPin catch or success → report branch of code actually hit (online success / online credential re-raise / shim fallthrough findByPin hit / shim findByPin returned null → throw Incorrect PIN)

## Notes
- v2's controlled integrated browser view: 7746 reset PIN → nav #/pos, banner I Igwe Klal Online WAITER. User says "its not working" about THEIR actual environment.
- The discrepancy must be a difference between: the server URL being hit; the POS bundle loaded in THEIR browser; the specific PIN/employee combo they reset; or their browser has cached POS state.
