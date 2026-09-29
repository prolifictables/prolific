/** Stable SQLite outbox identities shared by cashier checkout and staging tests. */
export function buildPosSaleSyncRows(orderId: string, paymentId: string, orderPayload: object, paymentPayload: object) {
  return {
    order: {
      op_id: `order_${orderId}`, entity_type: 'ORDER', operation: 'CREATE',
      entity_id: orderId, payload: JSON.stringify(orderPayload),
      idempotency_key: orderId, local_entity_version: 1,
    },
    payment: {
      op_id: `payment_${paymentId}`, entity_type: 'PAYMENT', operation: 'CREATE',
      entity_id: paymentId, payload: JSON.stringify(paymentPayload),
      idempotency_key: paymentId, local_entity_version: 1,
    },
  };
}

/** Payloads for PHP's authoritative pricing and payment lifecycle. Values are minor units. */
export function buildPhpSaleSyncRows(order: any, payment: any, items: any[]) {
  if ((order.shift_id || null) !== (payment.shift_id || null)) throw new Error('Payment must retain the original order shift.');
  if (!['DINE_IN', 'TAKEAWAY', 'PICKUP', 'DELIVERY'].includes(order.order_type)) throw new Error('Unsupported order type.');
  if (!Number.isSafeInteger(payment.amount_cents) || payment.amount_cents <= 0 || payment.amount_cents !== order.total_cents) throw new Error('Payment must equal the positive order total.');
  if (!['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'].includes(payment.method)) throw new Error('This payment method requires online provider verification.');
  if (order.tax_cents !== 0 || (order.tip_cents || 0) !== 0 || order.total_cents !== order.subtotal_cents - order.discount_cents) throw new Error('Order totals do not match the PHP POS policy.');
  if (!items.length || items.some(i => !i.menu_item_id || !Number.isInteger(i.quantity) || i.quantity < 1 || i.modifierOptions?.length)) throw new Error('Valid items without modifiers are required for PHP checkout.');
  const rows = buildPosSaleSyncRows(order.id, payment.id, {
    restaurantId: order.restaurant_id, branchId: order.branch_id, employeeId: order.employee_id,
    idempotencyKey: order.id, type: order.order_type, source: 'POS',
    orderNumber: order.order_number, totalCents: order.total_cents, expectedTotalCents: order.total_cents,
    ...(order.discount_id ? { discountId: order.discount_id } : {}),
    items: items.map(i => ({ menuItemId: i.menu_item_id, quantity: i.quantity })),
  }, {
    restaurantId: order.restaurant_id, branchId: order.branch_id, employeeId: order.employee_id,
    idempotencyKey: payment.id, orderId: order.id, method: payment.method, amountCents: payment.amount_cents,
    currency: payment.currency || 'NGN',
    ...(payment.shift_id ? { localShiftId: payment.shift_id } : {}),
  });
  const transition = (status: 'READY' | 'COMPLETED', version: number) => ({
    // Retain existing desktop transition identities across upgrades/retries.
    op_id: `phpstg_${status.toLowerCase()}_${order.id}`, entity_type: 'ORDER', operation: 'UPDATE',
    entity_id: order.id, payload: JSON.stringify({ status }),
    idempotency_key: `phpstg_${status.toLowerCase()}_${order.id}`, local_entity_version: version,
  });
  return [rows.order, rows.payment, transition('READY', 2), transition('COMPLETED', 3)];
}

/** PHP owns settlement state; preserve it locally, never assert it in creation requests. */
export function phpPaymentCreatePayload(payload: Record<string, any>) {
  const { status, verificationSource, providerResponse, completedAt, ...request } = payload;
  return request;
}
