# Debug Session: employees-500-error
- **Status**: [OPEN]
- **Issue**: `GET /api/v1/employees` returns 500 (Admin cannot load employees; employee creation may also be impacted)
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: .dbg/trae-debug-log-employees-500-error.ndjson

## Reproduction Steps
1. Start the Server (`:4000`) and Admin (`:3002`).
2. Sign in to Admin.
3. Navigate to Employees.
4. Observe `GET /api/v1/employees` → 500 in DevTools Network tab.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `listEmployees()` throws due to a Mongoose query/populate error (invalid field path / populate mismatch). | High | Low | Pending |
| B | RBAC/branch scoping produces an invalid query shape (e.g., undefined `branchId` in filter) causing server exception. | Med | Low | Pending |
| C | Response mapping/serialization crashes (e.g., accessing missing nested user fields like `address` / `emergencyContact`). | Med | Low | Pending |
| D | `ctx` injection is missing/undefined for this endpoint (guard/interceptor issue), causing runtime exception. | Low | Low | Pending |
| E | Mongo data contains unexpected types (legacy employee/user docs) causing transformation failure. | Low | Med | Pending |

## Log Evidence
- Confirmed: `listEmployees()` crashes when it tries to fetch branches using `_id: { $in: [...] }` and the set contains non-ObjectId values.
- Example (from debug logs): `sampleBranchIds` included `"Lagos Flagship"` which caused:
  - `CastError: Cast to ObjectId failed for value "Lagos Flagship" (type string) at path "_id" for model "Branch"`

## Verification Conclusion
- Fix applied in `EmployeesService.listEmployees()` to:
  - Filter invalid branch IDs before querying branches by `_id`
  - Optionally resolve invalid values by `Branch.name` to keep the UI enriched
- Verified via authenticated request: `GET /api/v1/employees` returns 200 and employees with `branchId: "Lagos Flagship"` are enriched with the correct branch object.
