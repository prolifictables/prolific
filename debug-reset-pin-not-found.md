# Debug Session: reset-pin-not-found
- **Status**: [OPEN]
- **Issue**: Admin “Reset Employee PIN” fails with `Employee <id> not found`
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: .dbg/trae-debug-log-reset-pin-not-found.ndjson

## Reproduction Steps
1. Start Server (`:4000`) and Admin (`:3002`).
2. Sign in to Admin.
3. Go to Employees → click “Reset PIN” on an employee.
4. Confirm “Generate New PIN”.
5. Observe toast error: `Employee <id> not found`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Admin is calling `POST /employees/:id/reset-pin` with the wrong identifier (e.g. userId instead of employeeId). | High | Low | Pending |
| B | Backend `resetPin()` is scoped by `branchId` (or other ctx fields) and rejects a valid employee that belongs to another branch. | High | Low | Pending |
| C | Backend is expecting ObjectId but receives a non-ObjectId string (id normalization bug). | Med | Low | Pending |
| D | Permissions/guards are altering ctx or blocking access and backend returns “not found” to avoid information leaks. | Low | Low | Pending |
| E | Employee exists but is soft-disabled/inactive and excluded by a query condition. | Low | Low | Pending |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
