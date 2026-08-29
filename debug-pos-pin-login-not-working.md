# Debug Session: pos-pin-login-not-working
**Status:** [OPEN] — Investigation
**Created:** 2026-08-29
**Symptom:** User unable to login to POS using the 4-digit PIN generated from Admin portal → Employee Reset PIN.
**Expected:** Type 4 digits in POS PIN pad → Sign In → lands on /pos CashierScreen.
**Actual:** "Incorrect PIN" error in POS login toast/banner; bcrypt compare never reached or returns false.

## Hypotheses (Falsifiable)
- H1: Admin reset PIN toast display mismatch (wrong rawPin shown vs hashed saved)
- H2: bcrypt string type mismatch (Number/string/leading zeros asymmetry) between resetPin hash create vs login compare
- H3: Phase2 candidate query still 0 results (status/$or filter + pin:$exists combined with extra filters)
- H4: HTTP401/network swallowed → POS fallthrough to offline shim findByPin (SEEDED_EMPLOYEES only)
- H5: resetPin findByIdAndUpdate no-op (nModified=0) due to wrong employee _id / stale reference

## Files Modified for Instrumentation
(Added after Step 3)

## Runtime Evidence & Logs
(Populated after Debug Server captures)

## Root Cause Confirmation
(TBD)
