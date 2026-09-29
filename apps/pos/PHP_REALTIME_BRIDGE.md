# PHP Web POS staging update bridge

In explicit `VITE_WEB_PHP_MODE=1`, the browser does not connect to Node Socket.IO or call Node's public recent-orders endpoint. PHP currently has no equivalent event stream. The browser polls the authenticated, branch-scoped PHP `GET /api/v1/orders?limit=200` every 30 seconds for external orders; the existing cashier 8-second local refresh then updates its panels.

This is a temporary polling bridge, not Socket.IO event parity. External orders may appear roughly 30–38 seconds after creation, the 200-order window can miss older changes, and cross-client status notifications have not been proven in a browser-to-browser test. Production cutover remains gated on proving these cases or replacing this bridge with an authenticated event stream.

The browser receipt is locally generated. Its stable `clientOrderNumber` is stored on the PHP order alongside the server-generated order number. For offline sales the receipt can print before the server acknowledges sync; use the outbox status to distinguish locally recorded from backend-delivered sales.
