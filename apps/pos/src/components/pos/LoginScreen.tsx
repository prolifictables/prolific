'use client';

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_FOOTER_COPYRIGHT } from '../../lib/app-meta';
import { useAuthStore } from '../../lib/auth-store';
import type { ConnectionPillState } from '../../lib/types';
import { fetchPublicMenu, listPublicBranches } from '../../lib/remote-menu';
import {
  pinLogin,
  preWakeApi,
  SERVER_UNREACHABLE_MARKER,
} from '../../lib/remote-auth';
import { fetchPosBootstrap } from '../../lib/remote-pos';
import { ApiWakeState, subscribeApiWake } from '../../lib/api-wake';
import { applyRemoteMenuSnapshot } from '../../lib/mock-electron-shim';

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

// Server unreachable error-message marker — same string set by remote-auth.ts AND
// mock-electron-shim.ts. When any error .message includes this token we treat
// the error as TRANSPORT-LEVEL (server unreachable / DNS / CORS / Render cold-
// start timed out) rather than an actual credential mismatch. LoginScreen
// shows an AMBER warning chip instead of the rose-red "Incorrect PIN" chip
// for this case. This also short-circuits the shim fallback entirely so we
// don't waste the user's time on another 15-30s double-wait.
const hasUnreachableMarker = (msg: string): boolean => {
  if (typeof msg !== 'string') return false;
  return (
    msg.includes(SERVER_UNREACHABLE_MARKER) ||
    /SERVER_UNREACHABLE/.test(msg)
  );
};

/**
 * For Server-Unreachable error messages: cashier never typed the wrong PIN.
 * The backend is simply unreachable / sleeping / timing out / DNS failing.
 * Show an amber warning (no auto-clear PIN) instead of rose (wrong PIN).
 */
const humanUnreachableChip = (rawMsg: string): string => {
  const without = rawMsg
    .replace(/🔴\s*SERVER_UNREACHABLE:\s*/, '')
    .replace(/SERVER_UNREACHABLE:\s*/, '');
  return `⚠️ ${without.replace(/^⚠️\s*/, '')}`;
};

// Returns gold/amber status chip classes based on connection status
function connectionChipClasses(status: string) {
  switch (status?.toUpperCase()) {
    case 'ONLINE':
      return 'bg-[linear-gradient(120deg,rgba(16,185,129,0.22),rgba(212,175,55,0.18))] text-emerald-200 ring-1 ring-inset ring-emerald-400/30';
    case 'SYNCHRONIZING':
      return 'chip-neon text-amber-100 animate-pulse-soft';
    case 'SYNC_ERROR':
      return 'bg-[linear-gradient(120deg,rgba(234,88,12,0.22),rgba(205,127,50,0.20))] text-amber-200 ring-1 ring-inset ring-amber-500/30';
    case 'OFFLINE':
    default:
      return 'bg-[linear-gradient(120deg,rgba(100,116,139,0.20),rgba(205,127,50,0.12))] text-slate-300 ring-1 ring-inset ring-slate-500/25';
  }
}

function connectionDotClass(status: string) {
  switch (status?.toUpperCase()) {
    case 'ONLINE':
      return 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.75)]';
    case 'SYNCHRONIZING':
      return 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.75)] animate-pulse-soft';
    case 'SYNC_ERROR':
      return 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.75)]';
    case 'OFFLINE':
    default:
      return 'bg-slate-400 shadow-[0_0_6px_rgba(148,163,184,0.5)]';
  }
}

export default function LoginScreen() {
  const navigate = useNavigate();
  const authActions = useAuthStore((s) => s.actions);

  const [connection, setConnection] = useState<ConnectionPillState>({
    status: 'OFFLINE',
    pendingCount: 0,
    failedCount: 0,
  });

  const [onlineBranches, setOnlineBranches] = useState<any[]>([]);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  // Distinct error class: true when pinError was caused by SERVER_UNREACHABLE
  // (transport-level), false when caused by an actual credential mismatch.
  // This exists because we transform the raw error marker string into a
  // human-friendly message before storing it to pinError (so the marker is
  // no longer present at render-time to be re-detected via hasUnreachableMarker).
  const [pinErrorUnreachable, setPinErrorUnreachable] = useState<boolean>(false);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [resolvedBranch, setResolvedBranch] = useState<any>(null);

  // --- Render cold-start: subscribe to the global API wake bus so we can
  // surface an inline "Checking server…" pill above the PIN pad (instead of
  // throwing a jarring full-screen modal at the user the second they land on
  // the page). If the server is asleep, we silently start warming it in the
  // background; if the user taps Sign In BEFORE the warm completes, we then
  // escalate to a full overlay (see guardedFetch source='reactive' branch).
  const [wake, setWake] = useState<ApiWakeState>({
    isWaking: false,
    source: null,
    attempt: 0,
    elapsedMs: 0,
    etaMs: 0,
    message: '',
  });
  useEffect(() => subscribeApiWake((n) => setWake(n)), []);

  // Kick off a SILENT (no blocking modal) pre-warm the instant LoginScreen
  // mounts. 90%+ of the time the server is already awake by the time the
  // cashier finds their name badge, reads the 4-6 digit PIN off the admin
  // reset toast, and types it in on the physical PIN pad.
  useEffect(() => {
    void preWakeApi();
  }, []);

  // Pill status label + dot class are overridden during proactive (background)
  // wake. We keep the connection chip style (SYNCHRONIZING amber pulse) so the
  // cashier can immediately tell "the system is doing something, not dead"
  // without an ugly popup blocking the screen.
  const pillStatus = wake.isWaking && wake.source === 'proactive' ? 'SYNCHRONIZING' : connection.status;
  const pillLabel = wake.isWaking && wake.source === 'proactive' ? 'Checking server…' : connection.status;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st: any = await window.electronAPI?.getConnectionStatus?.();
        if (!alive) return;
        const counts: any = (await window.electronAPI?.db?.syncQueue?.getCounts?.()) || {};
        setConnection({
          status: st?.status || 'OFFLINE',
          pendingCount: counts?.pending || 0,
          failedCount: counts?.failed || 0,
          lastSuccessfulAt: st?.lastSuccessfulAt,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Load the list of branches from the public endpoint. We still keep this
  // cached so offline mode can fall back to a known branch shape, but we no
  // longer present it as a user-facing picker — the server resolves the
  // employee's assigned branch automatically on PIN login.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Dynamically import so removing the default export doesn't break
        // builds if listPublicBranches is ever trimmed.
        const { listPublicBranches } = await import('../../lib/remote-menu');
        const branches = await listPublicBranches();
        if (!alive) return;
        setOnlineBranches(branches);
        if (branches[0]) setResolvedBranch(branches[0]);
      } catch {
        // ignore — fall back to offline default below
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pressPin = (k: string) => {
    if (k === '⌫') {
      setPin((p) => {
        const next = p.slice(0, -1);
        return next;
      });
      setPinError(null);
      setPinErrorUnreachable(false);
      return;
    }
    if (!k) return;
    if (pin.length >= 6) return;
    setPin((p) => {
      const next = p + k;
      return next;
    });
    // Typing a digit → clear any prior error (both unreachable and
    // Incorrect PIN) so the cashier's new attempt feels fresh.
    setPinError(null);
    setPinErrorUnreachable(false);
  };

  // Builds a normalized employee object + stub-restaurant + offline-branch
  // shape identical to what setOfflinePinLogin()/setOnlineLogin() expect.
  // Shared between the INSTANT offline-first fast-path (<50ms SQLite pin
  // verify) AND the historical online-first SLOW fallback so both produce
  // identical session state.
  const buildOfflineSession = (found: any) => {
    const offlineEmployee = {
      id: found.id,
      userId: found.userId || found.user_id,
      restaurantId: found.restaurantId || found.restaurant_id,
      branchId: found.branchId || found.branch_id,
      role: found.role,
      positionTitle: found.positionTitle || found.position_title,
      employeeNumber: found.employeeNumber || found.employee_number,
      firstName: found.firstName || found.first_name,
      lastName: found.lastName || found.last_name,
      email: found.email,
      phone: found.phone,
    };
    const stubRestaurant = {
      id: offlineEmployee.restaurantId || 'rest-prolific-01',
      name: 'Prolific Tables',
      currency: 'NGN',
      country: 'NG',
    };
    const offlineBranchRaw =
      (offlineEmployee.branchId &&
        onlineBranches.find((b) => b.id === offlineEmployee.branchId)) ||
      resolvedBranch ||
      onlineBranches[0] ||
      null;
    const offlineBranch = offlineBranchRaw
      ? {
          ...offlineBranchRaw,
          restaurant: offlineBranchRaw.restaurant || stubRestaurant,
        }
      : {
          id: offlineEmployee.branchId || 'br-main-01',
          name: 'Port Harcourt',
          restaurant: stubRestaurant,
        };
    return { offlineEmployee, offlineBranch, stubRestaurant };
  };

  // Fetches menu (with stale-branch fallback) and writes to BOTH persistence
  // layers: browser-shim localStorage mirror AND Electron SQLite. Same logic
  // is used regardless of whether login was instant-offline-then-promoted or
  // online-first, guaranteeing the "last saved online menu = next-offline-
  // boot menu" invariant.
  const refreshAndPersistMenuSnapshot = async (
    preferredBranchId: string,
    restaurant: any
  ) => {
    const saved = { categories: [], items: [], modifiers: [] } as {
      categories: any[]; items: any[]; modifiers: any[];
    };
    let firstError: unknown = null;
    try {
      const menu = await fetchPublicMenu(String(preferredBranchId), undefined);
      saved.categories = menu.categories || [];
      saved.items = menu.items || [];
      saved.modifiers = menu.modifiers || [];
    } catch (err) {
      firstError = err;
    }
    let fallbackBranch: any = null;
    if ((saved.categories.length === 0 && saved.items.length === 0) || firstError) {
      try {
        const branches = await listPublicBranches();
        const fallback =
          branches.find((b: any) => b.isDefault === true) ||
          branches.find((b: any) => b.isActive !== false) ||
          branches[0];
        if (fallback?.id && String(fallback.id) !== String(preferredBranchId)) {
          const menu2 = await fetchPublicMenu(String(fallback.id), undefined);
          saved.categories = menu2.categories || [];
          saved.items = menu2.items || [];
          saved.modifiers = menu2.modifiers || [];
          fallbackBranch = { ...fallback, restaurant };
        }
      } catch {
        if (firstError) console.warn('[login] menu fallback failed', firstError);
      }
    }
    if (saved.categories.length > 0 || saved.items.length > 0) {
      applyRemoteMenuSnapshot(saved);
      try { await window.electronAPI?.db?.menu?.applySnapshot?.(saved); } catch { /* shim warmed */ }
    }
    return { snapshot: saved, fallbackBranch };
  };

  const submitPin = async () => {
    if (pin.length < 4) {
      setPinErrorUnreachable(false);
      setPinError('PIN must be 4–6 digits.');
      return;
    }
    setPinSubmitting(true);
    setPinError(null);
    setPinErrorUnreachable(false);
    try {
      // =====================================================================
      // PHASE 0 — ABSOLUTE OFFLINE PRIORITY (<50ms, NO NETWORK, NO AWAIT of
      // any network-dependent IPC on the critical path).
      // =====================================================================
      // User explicitly confirmed: "POS will be used MOSTLY without internet,
      // offline login should be priority." So we MUST NOT touch ANYTHING that
      // could wait on network or disk boot during the critical pin-submit →
      // cashier-screen window. Specifically:
      //   • findByPin(pin) — pure local SQLite + bcrypt. No network.
      //   • setOfflinePinLogin() — zustand persist writes to localStorage,
      //     its window.electronAPI.db.meta.setLastAuth IPC runs in background
      //     with .catch() (auth-store never awaits it).
      //   • getDeviceId() — moved to AFTER fast-path navigation, resolved
      //     lazily only if the background network warm actually fires. On
      //     terminals with cached employees, this IPC never blocks login.
      //   • Background warm: wrapped in setTimeout(..., 0) so React finishes
      //     navigation paint before any promise microtasks run. Smooth UX.
      //
      // Only reach the "slow" network path if findByPin returns null (the
      // employee has NEVER logged in on this specific terminal, or the
      // SQLite cache was destroyed — a rare event).
      // =====================================================================
      let foundFastPath: any = null;
      try {
        // Window contract (preload cashier.ts L65): findByPin(PIN, branchId?) —
        // PIN is FIRST argument, branchId optional second. Do NOT pass '' as a
        // placeholder for branchId — cashier.ts treats the first arg as PIN,
        // and main-process wrap + SQL repo fall back to cross-branch global
        // lookup when branchId is undefined / empty. This matches the "quick
        // service POS" priority: instant pin lookup against every cached
        // employee on this terminal regardless of which branch they belong
        // to (many single-branch installations anyway, Admin UI has 1 default
        // branch for all staff today).
        foundFastPath = await window.electronAPI?.db?.employees?.findByPin?.(pin);
      } catch {
        foundFastPath = null;
      }

      if (foundFastPath && (foundFastPath.id || foundFastPath._id)) {
        // (1) Normalize and write to offline auth store. zustand persists to
        // localStorage via JSON middleware so the session survives page
        // reload independently of the SQLite meta.setLastAuth IPC inside
        // setOfflinePinLogin (which is fire-and-forget via .catch()).
        const { offlineEmployee, offlineBranch } = buildOfflineSession(foundFastPath);
        authActions.setOfflinePinLogin(offlineEmployee, offlineBranch, pin);
        setResolvedBranch(offlineBranch);

        // (2) Schedule OPTIONAL network warm ONE TICK AFTER React finishes
        // navigation so no promise microtasks, IPC, or network contend for
        // the cashier screen paint. All "slow" work (deviceId fetch, Render
        // cold wake, bootstrap roster, menu persist, sync kick) runs here.
        const pinForWarm = pin;
        setTimeout(() => {
          void (async () => {
            // Lazily fetch deviceId ONLY if background warm actually runs.
            // This avoids the IPC on 2nd+ logins where fast-path hits.
            let warmDeviceId: string | undefined;
            try {
              const dev = await window.electronAPI?.getDeviceId?.();
              warmDeviceId = dev?.deviceId;
            } catch { /* keep undefined — optional on server side */ }

            try {
              const res: any = await pinLogin({ pin: pinForWarm, deviceId: warmDeviceId });
              const employee = res?.employee || null;
              const user = res?.user || null;
              const restaurant = res?.restaurant || null;
              const branch = res?.branch || null;
              const accessToken = res?.accessToken;
              const refreshToken = res?.refreshToken;
              const expiresIn = res?.expiresIn;
              if (employee?.id && user?.id && branch?.id && restaurant?.id && accessToken) {
                const employeeRecord = {
                  id: employee.id,
                  userId: user.id,
                  firstName: user.firstName,
                  lastName: user.lastName,
                  email: user.email,
                  phone: user.phone,
                  role: employee.role,
                  branchId: employee.branchId,
                  restaurantId: employee.restaurantId,
                };
                // Keep local pin cache fresh for NEXT offline login.
                try {
                  await window.electronAPI?.db?.employees?.upsertWithPin?.(employeeRecord, pinForWarm);
                } catch { /* offline session still valid even if cache write fails */ }
                // Promote silently in-place. No reload.
                authActions.promoteOnlineLogin({
                  employee: employeeRecord,
                  restaurant,
                  branch: { ...branch, restaurant },
                  accessToken,
                  refreshToken,
                  expiresIn,
                  deviceId: warmDeviceId,
                });
                // Persist roster / tables / menu for next offline boot.
                try {
                  const bootstrap = await fetchPosBootstrap({ accessToken });
                  try { await window.electronAPI?.db?.employees?.applySnapshot?.(bootstrap.employees); } catch { /* ignore */ }
                  try { await window.electronAPI?.db?.tables?.applySnapshot?.(bootstrap.tables); } catch { /* ignore */ }
                } catch { /* ignore — MenuGrid 8s polls will catch up */ }
                try {
                  const { fallbackBranch } = await refreshAndPersistMenuSnapshot(String(branch.id), restaurant);
                  if (fallbackBranch) authActions.patchBranch(fallbackBranch);
                } catch { /* ignore */ }
                try { await window.electronAPI?.sync?.requestNow?.(); } catch { /* ignore — QueueReader cycles every 1.5s */ }
              }
            } catch (backgroundErr: any) {
              // On primary-offline deployment this branch fires most often.
              // Keep COMPLETELY silent — no warning chips, no popups. Cashier
              // is already taking orders on the OFFLINE_PIN session they got
              // in <50ms. Console only for the manager debugging later.
              const bgMsg = String((backgroundErr as any)?.message || String(backgroundErr));
              if (hasUnreachableMarker(bgMsg)) {
                console.info('[login:bg-warm] Server offline / cold. Session retained OFFLINE. Queue/MenuGrid auto-retry.');
                return;
              }
              // Explicit 4xx from server: Admin rotated PIN on server but it
              // hasn't synced locally yet. Continue offline (priority 1),
              // warn once in devtools.
              console.warn('[login:bg-warm] Online verify rejected PIN, offline session retained per primary-offline policy:', bgMsg);
            }
          })();
        }, 0);

        // (3) NAVIGATE. Absolutely NO awaits before this line on fast-path.
        setPinSubmitting(false);
        navigate('/pos', { replace: true });
        return;
      }

      // =====================================================================
      // FALLBACK PATH — LOCAL CACHE MISS. Only reachable when this employee
      // has NEVER logged in on this terminal before (OR the local DB was
      // wiped). Slow 45s Render wake budget is acceptable ONCE here.
      // =====================================================================
      const device = await window.electronAPI?.getDeviceId?.();
      const deviceId = device?.deviceId;

      try {
        const res: any = await pinLogin({ pin, deviceId });
        const employee = res?.employee || null;
        const user = res?.user || null;
        const restaurant = res?.restaurant || null;
        const branch = res?.branch || null;
        const accessToken = res?.accessToken;
        const refreshToken = res?.refreshToken;
        const expiresIn = res?.expiresIn;

        if (!employee?.id || !user?.id || !branch?.id || !restaurant?.id || !accessToken) {
          throw new Error('Login response missing required fields');
        }

        const employeeRecord = {
          id: employee.id,
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: employee.role,
          branchId: employee.branchId,
          restaurantId: employee.restaurantId,
        };

        await window.electronAPI?.db?.employees?.upsertWithPin?.(employeeRecord, pin);

        authActions.setOnlineLogin({
          employee: employeeRecord,
          restaurant,
          branch: { ...branch, restaurant },
          accessToken,
          refreshToken,
          expiresIn,
          deviceId,
        });

        setResolvedBranch(branch);

        void (async () => {
          try {
            const bootstrap = await fetchPosBootstrap({ accessToken });
            await window.electronAPI?.db?.employees?.applySnapshot?.(bootstrap.employees);
            await window.electronAPI?.db?.tables?.applySnapshot?.(bootstrap.tables);
          } catch {
          }
          try {
            const { fallbackBranch } = await refreshAndPersistMenuSnapshot(String(branch.id), restaurant);
            if (fallbackBranch) {
              setResolvedBranch(fallbackBranch);
              authActions.patchBranch(fallbackBranch);
            }
          } catch {
          }
          try {
            await window.electronAPI?.sync?.requestNow?.();
          } catch {
          }
        })();

        navigate('/pos', { replace: true });
        return;
      } catch (err: any) {
        const msg = String(err?.message || String(err));
        if (hasUnreachableMarker(msg)) {
          throw err;
        }
        const isInvalidPinResponse =
          /invalid pin/i.test(msg) ||
          /unauthorized/i.test(msg) ||
          /http 4\d\d/i.test(msg) ||
          /pin must be/i.test(msg);
        if (isInvalidPinResponse) {
          throw new Error(err?.message || 'Incorrect PIN.');
        }
      }

      // Only reached when online-first fallback threw an UNCLASSIFIED error
      // (not unreachable, not invalid PIN) AND the fast-path findByPin also
      // missed (otherwise we'd have returned in Phase 0). Final last-ditch
      // attempt to fall to offline shim/SQLite once more — if still null →
      // Incorrect PIN rose chip.
      const found: any = await window.electronAPI?.db?.employees?.findByPin?.(pin);
      if (!found) {
        throw new Error('Incorrect PIN. Please try again or ask your manager for assistance.');
      }
      const { offlineEmployee, offlineBranch } = buildOfflineSession(found);
      authActions.setOfflinePinLogin(offlineEmployee, offlineBranch, pin);
      navigate('/pos', { replace: true });
    } catch (e: any) {
      const finalMsg = String(e?.message || String(e));
      if (hasUnreachableMarker(finalMsg)) {
        setPinErrorUnreachable(true);
        setPinError(
          humanUnreachableChip(finalMsg) ||
            '⚠️ Server unreachable. Wait 60 seconds, then try again, or contact your manager if the problem continues.'
        );
      } else {
        setPinErrorUnreachable(false);
        setPinError(
          finalMsg || 'Incorrect PIN. Please try again or ask your manager for assistance.'
        );
        setPin('');
      }
    } finally {
      setPinSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-stretch justify-center relative overflow-hidden">
      {/* Ambient gold/copper radial blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-40 h-[34rem] w-[34rem] rounded-full opacity-60"
          style={{ background: 'radial-gradient(circle, rgba(255,215,0,0.22) 0%, rgba(212,175,55,0.12) 40%, transparent 70%)' }}
        />
        <div className="absolute -bottom-40 -right-40 h-[36rem] w-[36rem] rounded-full opacity-70"
          style={{ background: 'radial-gradient(circle, rgba(205,127,50,0.22) 0%, rgba(234,88,12,0.12) 45%, transparent 70%)' }}
        />
      </div>

      {/* Cyber grid backdrop */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.18] bg-cyber-grid animate-grid-scroll" />

      {/* Connection pill — upgraded post-692128b professional fix:
          When server is cold-booting, show "Checking server…" with amber SYNCHRONIZING
          pulse (inline chip, NO full-blocking modal). Only escalates to a real modal
          if the cashier taps Sign In while still waking. See ApiWakeOverlay source
          rule: isWaking && source === 'proactive' → render nothing. */}
      <div className="absolute top-5 right-5 z-10">
        <div
          className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold ${connectionChipClasses(pillStatus)}`}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${connectionDotClass(pillStatus)}`} />
          <span className="uppercase tracking-wider text-xs font-bold">{pillLabel}</span>
          {connection.pendingCount > 0 && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black tabular-nums">
              {connection.pendingCount} pending
            </span>
          )}
          {connection.failedCount > 0 && (
            <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-black tabular-nums text-rose-200 ring-1 ring-inset ring-rose-400/25">
              {connection.failedCount} failed
            </span>
          )}
        </div>
        {/* Inline 1-line estimate for proactive wake — sits UNDER the chip so
            cashiers know the server will be ready in < 90s. Collapses to nothing
            once API is online. */}
        {wake.isWaking && wake.source === 'proactive' && wake.elapsedMs > 0 ? (
          <div className="mt-1.5 text-right text-[11px] font-semibold tabular-nums text-amber-300/70 pr-2">
            {Math.max(1, Math.floor(wake.elapsedMs / 1000))}s · ~{Math.max(0, Math.floor(wake.etaMs / 1000))}s left
          </div>
        ) : null}
      </div>

      {/* Bump 2-column layout from md (768px) to lg (1024px) so short-but-wide cashier terminals
          fall back to single-column layout (brand panel on top, auth card below). This avoids
          the brand + auth cards competing for the same tiny vertical slab on 768–1023px wide
          displays with < 560px of viewport height, where the Sign In CTA previously overflowed.
          pb-20 ensures content never overlaps the absolutely-positioned footer layer below
          (which sits at bottom=0, height ≈ 52px) on short 600px-tall cashier terminals. */}
      <div className="relative z-10 w-full max-w-6xl grid lg:grid-cols-2 gap-5 p-5 pb-20 items-stretch">
        {/* Left brand / hero panel — compact on short terminals (< lg) since it stacks ABOVE the auth card.
            On >= lg terminals we keep the full side-by-side 2-column layout with feature tiles.
            On very SHORT terminals (< 700px high, typical compact cashier display) hide the brand
            panel entirely so the Sign In CTA sits above the viewport fold on first paint; speed > branding
            on a cashier terminal where the app identity is already known. */}
        <div className="flex flex-col justify-center items-center lg:items-start text-center lg:text-left lg:py-6 py-2 [@media(max-height:700px)]:hidden">
          <div className="relative lg:mb-6 mb-3">
            <div className="absolute -inset-4 rounded-[2rem] opacity-50 blur-2xl"
              style={{ background: 'radial-gradient(circle, rgba(255,215,0,0.35) 0%, transparent 65%)' }}
            />
            <div className="relative inline-flex lg:h-24 lg:w-24 h-16 w-16 items-center justify-center lg:rounded-3xl rounded-2xl ring-1 ring-white/15 shadow-glow-restaurant animate-neon-pulse"
              style={{ background: 'linear-gradient(135deg, #FFD700 0%, #D4AF37 45%, #CD7F32 100%)' }}
            >
              <span className="lg:text-5xl text-3xl font-black text-slate-950 tracking-tight">P</span>
            </div>
          </div>
          <h1 className="lg:text-5xl text-3xl md:text-4xl font-black tracking-tight leading-[1.02] animate-text-glow">
            <span className="text-gradient-neon">Prolific</span>
            <span className="text-white"> POS</span>
          </h1>
          <p className="lg:mt-4 mt-2 text-ink-300 lg:text-lg text-sm max-w-md leading-relaxed">
            Cashier terminal engineered for speed. Gold-tier offline reliability, split tender, table service & auto-sync.
          </p>

          {/* Feature tiles: only visible on >= lg where 2-column layout gives enough vertical room */}
          <div className="lg:mt-6 lg:grid hidden grid-cols-3 gap-3 w-full max-w-md">
            {[
              { icon: '⚡', label: 'Works Offline', tint: 'from-amber-500/20' },
              { icon: '💳', label: 'Split Tender', tint: 'from-[#CD7F32]/20' },
              { icon: '📟', label: 'Auto Sync', tint: 'from-[#FFD700]/20' },
            ].map((f) => (
              <div key={f.label} className="card-glow card p-4 relative overflow-hidden group">
                <div className={`absolute -top-8 -right-8 h-20 w-20 rounded-full blur-2xl opacity-70 bg-gradient-to-br ${f.tint} to-transparent`} />
                <div className="relative text-2xl mb-1">{f.icon}</div>
                <div className="relative text-[10px] uppercase tracking-[0.15em] text-ink-300 font-black leading-tight">
                  {f.label}
                </div>
              </div>
            ))}
          </div>

          <div className="lg:mt-5 mt-2 text-[10px] uppercase tracking-widest font-bold text-amber-400/80">
            ✨ Sign in to begin your shift
          </div>
        </div>

        {/* Right auth card — compact vertical sizing so the "Open Shift & Sign In" CTA always fits above the viewport fold on cashier terminals.
            No max-h on the card itself — if viewport is very short, the full PAGE scrolls so the CTA is always reachable.
            (Inner card max-height + overflow caused the action button to be unreachable on short displays.) */}
        <div className="card-glow card neon-border lg:p-5 p-3 animate-slide-up self-start w-full relative overflow-hidden">
          {/* Gold light beams at top */}
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-56 w-[120%] opacity-40 blur-3xl pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at top, rgba(255,215,0,0.35) 0%, transparent 60%)' }}
          />

          <div className="space-y-3 relative">
            <div className="rounded-2xl p-3 ring-1 ring-inset ring-white/10 bg-slate-950/40 text-xs text-ink-200">
              Enter your staff PIN. If the network is down, Prolific POS automatically falls back to offline mode and syncs when you’re online again.
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-black text-ink-200 tracking-wide uppercase">
                  Enter PIN
                </label>
                <span className="text-xs text-ink-400 font-bold tabular-nums">
                  {pin.length}/6
                </span>
              </div>
              <div className="lg:min-h-11 min-h-9 rounded-2xl bg-slate-950/60 ring-1 ring-inset ring-amber-400/20 flex items-center justify-center relative overflow-hidden">
                <div
                  className="absolute inset-0 opacity-30"
                  style={{ background: 'radial-gradient(circle at 50% 0%, rgba(255,215,0,0.25) 0%, transparent 60%)' }}
                />
                <div className="lg:text-2xl text-xl font-black tabular-nums tracking-[0.3em] relative">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i} className={pin[i] ? 'text-amber-300 animate-text-glow' : 'text-slate-700'}>
                      {pin[i] ? '●' : '·'}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 [@media(max-height:500px)]:grid-cols-6 gap-1 [@media(max-height:500px)]:gap-1">
                {PIN_KEYS.map((k, i) => (
                  <button
                    key={i}
                    onClick={() => pressPin(k)}
                    disabled={!k && true}
                    className={`lg:min-h-12 min-h-9 [@media(max-height:500px)]:min-h-8 rounded-2xl font-black lg:text-xl text-lg [@media(max-height:500px)]:text-base transition-all active:scale-[0.96] disabled:opacity-0 relative overflow-hidden ${
                      k === '⌫'
                        ? 'bg-rose-500/10 text-rose-200 ring-1 ring-inset ring-rose-500/25 hover:bg-rose-500/20'
                        : k
                          ? 'text-white ring-1 ring-inset ring-white/10 hover:ring-amber-400/40 hover:shadow-glow-restaurant'
                          : ''
                    }`}
                    style={k && k !== '⌫' ? {
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(212,175,55,0.04) 100%)',
                    } : {}}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {pinError && (() => {
              // Professional two-class error chip.
              //  • SERVER_UNREACHABLE → AMBER background, warning implies
              //    "system problem, not your fault". PIN digits are preserved.
              //  • Incorrect PIN → ROSE background, implies wrong digits.
              //    PIN digits auto-cleared on this path so cashier retypes.
              const unreachable = pinErrorUnreachable;
              const cls = unreachable
                ? 'rounded-2xl bg-amber-500/10 text-amber-200 text-sm font-bold px-4 py-2.5 ring-1 ring-inset ring-amber-500/25'
                : 'rounded-2xl bg-rose-500/10 text-rose-200 text-sm font-bold px-4 py-2.5 ring-1 ring-inset ring-rose-500/25';
              return <div className={cls}>{pinError}</div>;
            })()}

            <button
              onClick={submitPin}
              disabled={pinSubmitting || pin.length < 4}
              className="w-full text-sm font-black lg:min-h-11 min-h-9 disabled:opacity-40 disabled:cursor-not-allowed btn-success"
            >
              {pinSubmitting ? '🔐 Verifying PIN…' : '⚡ Sign In'}
            </button>
          </div>
        </div>
      </div>

      {/* FOOTER LAYER — ABSOLUTELY POSITIONED (non-flow).
          Professional engineering rationale:
            The previous 2 footer attempts broke layout because they were inserted
            as FLOW SIBLINGS inside the outer flex, which changed the flex's
            implicit size calculation (flex defaults to row → scattering, or
            column → height push). By rendering position:absolute, this footer
            does NOT participate in flex layout → CANNOT affect the working
            brand/PIN grid → scattering is mathematically impossible.
            pb-20 on the grid above guarantees no overlap on short displays. */}
      <div className="absolute inset-x-0 bottom-0 z-20 pb-3 pt-2 px-4 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-950/60 ring-1 ring-inset ring-white/10 backdrop-blur-md">
          <span className="text-[10px] uppercase tracking-[0.18em] font-black text-amber-400/80">
            POS Desktop
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span className="text-xs font-semibold text-ink-300 whitespace-nowrap">
            {APP_FOOTER_COPYRIGHT}
          </span>
        </div>
      </div>
    </div>
  );
}
