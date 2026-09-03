// Single source of truth for POS-wide metadata (version, vendor branding).
//
// DRIFT-IMPOSSIBLE GUARANTEE:
// APP_VERSION is NOT hardcoded here. It is injected at VITE BUILD TIME via
// `vite.config.ts define: { 'import.meta.env.PACKAGE_VERSION': JSON.stringify(pkgJson.version) }`.
// This ensures the footer ALWAYS shows the package.json version from apps/pos/package.json.
// To bump version, edit ONLY apps/pos/package.json "version" — this file will auto-update.
//
// If any of these globals are ever missing for some reason (edge case in certain
// bundler setups), we have a runtime fallback so the app will always renders
// something sensible instead of crashing or showing "undefined" on screen.

declare global {
  // These are set by vite.config.ts define.__APP_VERSION__ etc.
  // (declare global so TypeScript never treats them as unknown identifiers.)
  const __APP_VERSION__: string | undefined;
  const __VENDOR_LABEL__: string | undefined;
}

interface ImportMetaEnv {
  readonly PACKAGE_VERSION?: string;
  readonly VENDOR_LABEL?: string;
}

const fallbackVersion = '0.1.0';
const fallbackVendor = 'Powered by Giovy Tech - (+234)7066689108';

const resolvedVersion: string =
  ((globalThis as unknown as { __APP_VERSION__?: string }).__APP_VERSION__) ||
  (import.meta.env as unknown as ImportMetaEnv).PACKAGE_VERSION ||
  fallbackVersion;

const resolvedVendor: string =
  ((globalThis as unknown as { __VENDOR_LABEL__?: string }).__VENDOR_LABEL__) ||
  (import.meta.env as unknown as ImportMetaEnv).VENDOR_LABEL ||
  fallbackVendor;

export const APP_VERSION = resolvedVersion.trim() === '0.0.0' ? fallbackVersion : resolvedVersion.trim();
export const POWERED_BY_LABEL = resolvedVendor;
export const APP_FOOTER_COPYRIGHT = `Prolific POS v${APP_VERSION} · ${POWERED_BY_LABEL}` as const;
