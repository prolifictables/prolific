# Debug Session: pos-sales-not-in-admin
- **Status**: [OPEN]
- **Issue**: POS records a sale locally, but Admin does not show the sale (Orders / Sales Report). POS browser shows ONLINE.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-pos-sales-not-in-admin.ndjson

## Expected vs Actual
- **Expected**: When a cashier completes a sale on POS, the sale should sync to the server and appear in Admin (Orders + Reports). POS History should also show it for that employee.
- **Actual**: Sale appears in POS, but Admin does not show it.

## Reproduction Steps
1. POS (browser or Electron) → ensure it says ONLINE.
2. Create an order and take a CASH payment (COMPLETED/PAID).
3. Admin → Orders / Sales Report → verify sale appears.

## Hypotheses (Falsifiable)
| ID | Hypothesis | Evidence to Collect |
|----|------------|---------------------|
| A | POS is not sending `/sync/batch` at all (browser “ONLINE” is UI-only). | Server receives no `sync.batch.enter` events. |
| B | POS sends `/sync/batch` but commands fail (validation/payload mismatch), so nothing is persisted. | `sync.batch.result` contains FAILED statuses + error messages. |
| C | Commands succeed but Admin is filtering wrong branch/date/status so it doesn’t display. | Server has Order/Payment docs, but Admin queries exclude them. |
| D | Sync succeeds but Payments don’t update Order.paymentStatus, so Sales Report excludes them. | Payment exists but Order.paymentStatus remains UNPAID/PENDING. |

## Notes
- We will instrument `SyncController.applyBatch` to confirm whether the server is receiving commands and whether they succeed.

## Evidence (Pre-fix)
- `sync.batch.enter` showed `deviceId=null` and `commandsCount=null` even when a valid JSON body was sent.
- Root cause: global `ValidationPipe({ whitelist: true })` strips all body fields for DTOs with no validation decorators, so `/sync/batch` saw an empty body.
