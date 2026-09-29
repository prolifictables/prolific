import type { ReposBundle } from './index';
import { buildPhpSaleSyncRows } from '../../../src/lib/pos-sale-sync-rows';

/** One local commit: a receipt can never outlive its durable delivery commands. */
export function savePosSale(repos: ReposBundle, input: { order: any; payment: any; items: any[] }) {
  const { order, payment, items } = input;
  const auth = repos.meta.getLastAuth();
  for (const [column, claim] of [['restaurant_id', 'restaurantId'], ['branch_id', 'branchId'], ['employee_id', 'employeeId']] as const) {
    if (!auth?.[claim] || order[column] !== auth[claim] || payment[column] !== auth[claim]) throw new Error('Checkout must match the current employee and branch.');
  }
  if (payment.order_id !== order.id) throw new Error('Payment order does not match.');
  const rows = buildPhpSaleSyncRows(order, payment, items);
  return repos.db.transaction(() => {
    const existing = repos.orders.getById(order.id);
    if (existing) {
      // Never reinterpret an already queued command after a lost IPC response.
      for (const row of rows) {
        const saved = repos.db.get<{ payload: string }>('SELECT payload FROM sync_queue WHERE op_id = ?', row.op_id);
        if (!saved || saved.payload !== row.payload) throw new Error('Existing checkout differs; review it before retrying.');
      }
      if (!repos.payments.listByOrderId(order.id).some(p => p.id === payment.id)) throw new Error('Existing checkout payment is incomplete.');
      return existing;
    }
    repos.orders.create({ table_id: null, table_session_id: null, customer_id: null, customer_name: null,
      customer_phone: null, customer_email: null, held_by: null, held_at: null, payment_method: null,
      paid_amount_cents: payment.amount_cents, balance_due_cents: 0, change_due_cents: 0,
      discount_id: null, note: null, split_group_id: null, server_version: 0, local_version: 1,
      synced: 0, created_at: Date.now(), updated_at: Date.now(), ...order });
    for (const item of items) repos.orders.addItem(order.id, { special_instructions: null, preparation_status: 'NEW', ...item });
    const storedItems = repos.db.all<{ id: string }>('SELECT id FROM order_items WHERE order_id = ?', order.id);
    if (storedItems.length !== items.length || items.some(i => !storedItems.some(s => s.id === i.id))) throw new Error('Checkout items were not fully saved.');
    repos.payments.create({ shift_id: null, provider: null, transaction_reference: null, tip_cents: 0,
      change_due_cents: 0, verification_source: 'LOCAL', completed_at: Date.now(), reference_note: null,
      failure_reason: null, provider_response_json: null, server_version: 0, local_version: 1,
      synced: 0, created_at: Date.now(), updated_at: Date.now(), ...payment });
    for (const row of rows) {
      if (!repos.syncQueue.push(row)) throw new Error('Could not persist checkout outbox.');
    }
    if (!repos.orders.getById(order.id) || !repos.payments.listByOrderId(order.id).some(p => p.id === payment.id)) throw new Error('Checkout persistence failed.');
    return repos.orders.getById(order.id);
  })();
}
