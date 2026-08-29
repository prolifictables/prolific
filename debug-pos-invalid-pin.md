# Debug Session: pos-invalid-pin
- **Status**: [OPEN]
- **Issue**: After Admin resets an employee PIN, POS login sometimes shows “Invalid PIN”
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-pos-invalid-pin.ndjson

## Reproduction Steps
1. Admin → Employees → Reset PIN for an employee → copy the generated PIN.
2. POS → Login → select a branch (or leave default) → enter the new PIN.
3. Observe “Invalid PIN”.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | POS is sending a different `branchId` than the employee record belongs to (branch mismatch), so server searches wrong employees and rejects the PIN. | High | Low | Pending |
| B | Server `loginWithPin` candidate query misses legacy employees where `employee.branchId` is stored as branch name instead of branch ObjectId. | Med | Low | Pending |
| C | Reset PIN updates a different employee record than the one you’re trying to log in with (duplicate employees/user in multiple branches). | Med | Low | Pending |
| D | There is a caching/stale-data issue and POS is attempting offline login with stale local PIN hash instead of the newly reset one. | Low | Med | Pending |

## Log Evidence
- Pre-fix: server threw `CastError` when POS sent a placeholder branch id like `br-main-01`:
  - `loginWithPin.error`: `Cast to ObjectId failed for value "br-main-01" ... model "Branch"`
- Post-fix: server no longer crashes and successfully logs in even if branch is placeholder:
  - `loginWithPin.branchResolve`: `branchFound=false`, `branchIdAliases=["br-main-01"]`
  - `loginWithPin.candidates`: `candidateCount=0`
  - `loginWithPin.fallbackCandidates`: finds candidates globally
  - `loginWithPin.success`: returns the employee’s real branch id

## Verification Conclusion
- Fix applied in `loginWithPin`:
  - Do not call `Branch.findById` unless the branch id is a valid ObjectId (prevents 500).
  - If no employee matches in the provided branch, fall back to matching PIN globally and then use the employee’s real branch.
- Fix applied in server CORS:
  - Allow any `http(s)://localhost:<port>` / `127.0.0.1:<port>` origins, and include `OPTIONS` in allowed methods so browser preflight succeeds.
