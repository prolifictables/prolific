'use client';

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/auth-store';
import type { ConnectionPillState } from '../../lib/types';
import { fetchPublicMenu } from '../../lib/remote-menu';
import { pinLogin } from '../../lib/remote-auth';
import { fetchPosBootstrap } from '../../lib/remote-pos';

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

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
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [resolvedBranch, setResolvedBranch] = useState<any>(null);

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
      setPin((p) => p.slice(0, -1));
      setPinError(null);
      return;
    }
    if (!k) return;
    if (pin.length >= 6) return;
    setPin((p) => p + k);
  };

  const submitPin = async () => {
    if (pin.length < 4) {
      setPinError('PIN must be 4–6 digits.');
      return;
    }
    setPinSubmitting(true);
    setPinError(null);
    try {
      const device = await window.electronAPI?.getDeviceId?.();
      const deviceId = device?.deviceId;

      // Branch selection has been removed from the login flow:
      // online PIN login now accepts an OPTIONAL branchId and resolves the
      // correct branch from the employee record server-side. This lets the
      // cashier go straight from PIN entry → POS without a picker.
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
            const menu = await fetchPublicMenu(String(branch.id), undefined);
            await window.electronAPI?.db?.menu?.applySnapshot?.({
              categories: menu.categories,
              items: menu.items,
              modifiers: menu.modifiers,
            });
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
        // #region debug-point pos-pin-login-not-working:F-submitPin-catch
        (() => {
          try {
            fetch("http://127.0.0.1:7777/event", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: "pos-pin-login-not-working",
                runId: "pre-fix",
                hypothesisId: "H4",
                location: "apps/pos/src/components/pos/LoginScreen.tsx submitPin pinLogin catch",
                msg: "[DEBUG] Online pinLogin FAILED — falling through to offline fallback shim findByPin",
                data: {
                  pinEntered: pin,
                  pinType: typeof pin,
                  pinLen: String(pin).length,
                  errName: err?.name,
                  errMessage: err?.message || String(err),
                  hasElectronDbFindByPin: Boolean(window.electronAPI?.db?.employees?.findByPin),
                },
                ts: Date.now(),
              }),
            }).catch(() => {});
          } catch {}
        })();
        // #endregion
        // Always fall through to offline mock shim / local SQLite fallback
        // regardless of the specific pinLogin failure type. This covers:
        // network failures, HTTP 401/500 from backend, CORS issues, invalid
        // deviceId, JSON parse errors, and any other unexpected exceptions.
        // In dev browser mode the mock-electron-shim provides seeded PINs
        // (1234 cashier, 0000 supervisor, 9999 manager); in production
        // Electron builds the real local SQLite employee cache is used.
      }

      // --- Offline fallback: find employee by PIN across all locally cached
      // employees, then use the assigned branch (or fallback branch shape)
      // without asking the cashier to pick a branch explicitly.
      const found: any = await window.electronAPI?.db?.employees?.findByPin?.('', pin);
      if (!found) {
        throw new Error('Incorrect PIN. Please try again or ask your manager for assistance.');
      }
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
      // Build a stub restaurant object so ShiftModal's restaurant.id guard
      // passes even when the online branch list and resolved network call
      // returned empty (the common browser-dev + mock shim case). auth-store
      // reads restaurant from branch.restaurant (line 76 auth-store.ts).
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
      // Ensure the branch we hand to auth-store ALWAYS has a non-null
      // .restaurant sub-object so ShiftModal OPEN check (restaurant.id)
      // and CashierScreenLayout header never see null restaurant.
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
      authActions.setOfflinePinLogin(offlineEmployee, offlineBranch, pin);
      navigate('/pos', { replace: true });
    } catch (e: any) {
      setPinError(e?.message || 'PIN does not match.');
      setPin('');
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

      {/* Connection pill */}
      <div className="absolute top-5 right-5 z-10">
        <div
          className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold ${connectionChipClasses(connection.status)}`}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${connectionDotClass(connection.status)}`} />
          <span className="uppercase tracking-wider text-xs font-bold">{connection.status}</span>
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
      </div>

      {/* Bump 2-column layout from md (768px) to lg (1024px) so short-but-wide cashier terminals
          fall back to single-column layout (brand panel on top, auth card below). This avoids
          the brand + auth cards competing for the same tiny vertical slab on 768–1023px wide
          displays with < 560px of viewport height, where the Sign In CTA previously overflowed. */}
      <div className="relative z-10 w-full max-w-6xl grid lg:grid-cols-2 gap-5 p-5 items-stretch">
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

            {pinError && (
              <div className="rounded-2xl bg-rose-500/10 text-rose-200 text-sm font-bold px-4 py-2.5 ring-1 ring-inset ring-rose-500/25">
                ⚠️ {pinError}
              </div>
            )}

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
    </div>
  );
}
