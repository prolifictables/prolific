// Centralized POS app metadata.
//
// VERSION must be kept in sync with apps/pos/package.json "version" field.
// Bump it here whenever a new Electron desktop build is released so the
// cashier + Admin are always on the same page for "what build is actually
// running on that terminal?" support questions.
export const APP_VERSION = '0.1.5';

// Vendor / powered-by branding string displayed on:
//   • Cashier login screen footer (client-facing terminal).
//   • Cashier main POS screen footer (client-facing terminal).
//   • Customer display idle / active-order / thank-you screens footer.
// Phone number is kept local to Nigeria (+234) per the client's request.
export const POWERED_BY_LABEL = 'Powered by Giovy Tech - (+234)7066689108';

// Short copyright / app-line label so version + vendor are kept compact on a
// single footer line in most screens.
export const APP_FOOTER_COPYRIGHT = `Prolific POS v${APP_VERSION} · ${POWERED_BY_LABEL}`;
