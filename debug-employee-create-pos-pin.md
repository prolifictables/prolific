[OPEN] Debug Session: employee-create-pos-pin

## Symptoms
- Admin: cannot create a new employee.
- POS: cannot log in using the generated employee PIN.

## Expected
- Creating an employee succeeds and returns the new employee record.
- POS PIN login succeeds online (server-verified) and offline (cached) after at least one successful online login.

## Repro Notes (to fill)
- Admin URL:
- POS mode: Electron / Browser preview:
- Branch used:
- PIN used:

## Hypotheses
- H1: Employee creation fails due to backend validation/unique constraint (email, employeeNumber, userId+branchId) or missing required context (branchId/restaurantId).
- H2: Employee is created, but the PIN hash is not saved correctly (or not returned) so `/auth/pin/login` cannot verify it.
- H3: POS PIN login fails because the POS uses a different branchId/deviceId than the employee record (branch mismatch).
- H4: POS PIN login fails because the server endpoint returns a 4xx/5xx (bad request handling) or token issuance fails, so the POS treats it as network/offline.

## Evidence (logs)
- Pre-fix:
- Post-fix:

## Fix Plan (once confirmed)
- Add instrumentation to server create-employee and pin-login flows.
- Reproduce from Admin and POS.
- Apply minimal fix based on evidence.

