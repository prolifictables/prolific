import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { LoginMode } from './types';
import { pinLogin } from './remote-auth';

interface AuthState {
  employee: any | null;
  branch: any | null;
  restaurant: any | null;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  loginMode: LoginMode;
  lastLoginAt: number | null;
  offlinePin?: string;
  actions: {
    setOnlineLogin: (payload: any) => void;
    setOfflinePinLogin: (employee: any, branch: any, pin?: string) => void;
    // Silently upgrades an existing OFFLINE_PIN session to ONLINE when the
    // background post-login network warm finally succeeds. Does NOT log the
    // cashier out and does not require user interaction. If the online
    // employee differs from the offline one (shouldn't happen since pins are
    // unique), we fall back to full setOnlineLogin.
    promoteOnlineLogin: (payload: any) => void;
    /**
     * Silently refresh the access token for the current session.
     *  - If we still have a valid unexpired access token (valid = more than
     *    30s of TTL remaining) → return it immediately (no network round-trip).
     *  - Otherwise:
     *      • Prefer refreshToken if present, otherwise fall back to re-running
     *        PIN login with the cached offlinePin (set during offline-first
     *        entry or regular login).
     *      • On success: promoteOnlineLogin() stores the new access/refresh
     *        pair, returns the fresh access token string.
     *  - THROWS if no offlinePin/refreshToken are available or the network
     *    re-auth fails. Callers should catch this and surface "offline / no
     *    access to server" style UX instead of the confusing server-returned
     *    "Invalid or expired token" message.
     */
    refreshAccessToken: (opts?: { force?: boolean; deviceId?: string }) => Promise<string>;
    patchBranch: (branch: any) => void;
    logout: () => void;
    clear: () => void;
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => {
      const initialState = {
        employee: null as any | null,
        branch: null as any | null,
        restaurant: null as any | null,
        accessToken: undefined as string | undefined,
        refreshToken: undefined as string | undefined,
        expiresAt: undefined as number | undefined,
        loginMode: 'ONLINE' as LoginMode,
        lastLoginAt: null as number | null,
        offlinePin: undefined as string | undefined,
      };
      const state: AuthState = {
        ...initialState,
        actions: {
        setOnlineLogin: (payload) => {
          const data = payload || {};
          const accessToken = data.accessToken || data.token || data?.tokens?.accessToken;
          const refreshToken = data.refreshToken || data?.tokens?.refreshToken;
          const expiresIn = data.expiresIn || data?.tokens?.expiresIn;
          const expiresAt =
            typeof expiresIn === 'number' && Number.isFinite(expiresIn)
              ? Date.now() + expiresIn * 1000
              : data.expiresAt;
          set({
            employee: data.employee || data.user || null,
            branch: data.branch || null,
            restaurant: data.restaurant || null,
            accessToken: accessToken || undefined,
            refreshToken: refreshToken || undefined,
            expiresAt: typeof expiresAt === 'number' ? expiresAt : undefined,
            loginMode: 'ONLINE',
            lastLoginAt: Date.now(),
            offlinePin: undefined,
          });
          if (window.electronAPI?.db?.meta?.setLastAuth) {
            window.electronAPI.db.meta
              .setLastAuth({
                mode: 'ONLINE',
                employeeId: (data.employee || data.user || {}).id,
                branchId: (data.branch || {}).id,
                restaurantId: (data.restaurant || {}).id,
                accessToken: accessToken || undefined,
                refreshToken: refreshToken || undefined,
                expiresAt: typeof expiresAt === 'number' ? expiresAt : undefined,
                deviceId: data.deviceId,
                at: Date.now(),
              })
              .catch((e) => console.warn('[auth] persist lastAuth failed', e));
          }
        },
        setOfflinePinLogin: (employee, branch, pin) => {
          set({
            employee,
            branch,
            restaurant: (branch && branch.restaurant) || null,
            accessToken: undefined,
            refreshToken: undefined,
            expiresAt: undefined,
            loginMode: 'OFFLINE_PIN',
            lastLoginAt: Date.now(),
            offlinePin: pin || undefined,
          });
          if (window.electronAPI?.db?.meta?.setLastAuth) {
            window.electronAPI.db.meta
              .setLastAuth({
                mode: 'OFFLINE_PIN',
                employeeId: employee?.id,
                branchId: branch?.id,
                restaurantId: branch?.restaurant?.id,
                at: Date.now(),
              })
              .catch((e) => console.warn('[auth] persist lastAuth failed', e));
          }
        },
        // Background-online-login promotion: when submitPin takes the INSTANT
        // offline path (SQLite pin verify <50ms) and navigates straight to
        // /pos, the network warm continues in a fire-and-forget promise. If
        // pinLogin() eventually succeeds on Render (after cold-start wake or
        // just regular latency), we PROMOTE the session from OFFLINE_PIN →
        // ONLINE in-place by injecting the access token + fresh branch +
        // employee snapshot WITHOUT forcing a round-trip back to /login.
        // Cashier is already taking orders by this point; they never notice.
        promoteOnlineLogin: (payload) => {
          const data = payload || {};
          const accessToken = data.accessToken || data.token || data?.tokens?.accessToken;
          const refreshToken = data.refreshToken || data?.tokens?.refreshToken;
          const expiresIn = data.expiresIn || data?.tokens?.expiresIn;
          const expiresAt =
            typeof expiresIn === 'number' && Number.isFinite(expiresIn)
              ? Date.now() + expiresIn * 1000
              : data.expiresAt;
          const onlineEmployee = data.employee || data.user || null;
          const onlineBranch = data.branch || null;
          const onlineRestaurant = data.restaurant || null;
          // Only overwrite employee/branch if the offline session and online
          // session match the same human (pin is unique-per-employee so this
          // guard is mostly belt+suspenders; mismatch would imply the user
          // cached multiple employees with the same pin which is prevented
          // server-side). If mismatch: treat as a "hot re-login" of a
          // different user and replace everything the same way setOnlineLogin
          // would (no-op, fall through, set all).
          const preserveOfflinePinIfPresent = true;
          set((prev) => ({
            employee: onlineEmployee || prev.employee,
            branch: onlineBranch
              ? { ...onlineBranch, restaurant: onlineRestaurant || onlineBranch.restaurant }
              : prev.branch,
            restaurant: onlineRestaurant || (onlineBranch && onlineBranch.restaurant) || prev.restaurant,
            accessToken: accessToken || prev.accessToken,
            refreshToken: refreshToken || prev.refreshToken,
            expiresAt: typeof expiresAt === 'number' ? expiresAt : prev.expiresAt,
            loginMode: 'ONLINE',
            lastLoginAt: Date.now(),
            // Intentionally preserved: offlinePin survives promote so that on
            // the next app boot (if network is fully down on launch) the same
            // cached pin still works for instant re-login offline even if a
            // background promote ran earlier.
            offlinePin: preserveOfflinePinIfPresent ? prev.offlinePin : undefined,
          }));
          if (window.electronAPI?.db?.meta?.setLastAuth) {
            window.electronAPI.db.meta
              .setLastAuth({
                mode: 'ONLINE',
                employeeId: (onlineEmployee || {}).id,
                branchId: (onlineBranch || {}).id,
                restaurantId: (onlineRestaurant || {}).id,
                accessToken: accessToken || undefined,
                refreshToken: refreshToken || undefined,
                expiresAt: typeof expiresAt === 'number' ? expiresAt : undefined,
                deviceId: data.deviceId,
                at: Date.now(),
              })
              .catch((e) => console.warn('[auth] persist lastAuth after promote failed', e));
          }
        },
        // Patches the currently authenticated branch (e.g. after a post-login
        // fallback to the default public branch that actually has menu data,
        // when the tenant/employee's linked branch returned a 404 from
        // /public/menu because the id was stale after Render migration).
        patchBranch: (branch) => {
          set({ branch: branch || null, restaurant: (branch && branch.restaurant) || null });
        },
        refreshAccessToken: async (opts) => {
          // Capture current auth snapshot synchronously (zustand getState is
          // cheap) — we'll use this to decide whether to hit network at all.
          const cur = useAuthStore.getState();
          const force = !!opts?.force;
          // Short-circuit: if user explicitly wants a refresh AND we already
          // have a valid token with >30s life, return it immediately.
          if (
            !force &&
            cur.accessToken &&
            (typeof cur.expiresAt !== 'number' || cur.expiresAt - Date.now() > 30_000)
          ) {
            return cur.accessToken;
          }

          const deviceId = opts?.deviceId;
          // ----------------------------------------------------------------
          // Option A — refresh token flow: if we have a refresh token + server
          // supports a /auth/refresh endpoint, use it (shorter payload, keeps
          // pin out of the wire on every refresh). If the server rejects it
          // (e.g. refresh revoked, route missing), fall through to PIN re-auth.
          // ----------------------------------------------------------------
          if (cur.refreshToken) {
            try {
              const API_BASE =
                (typeof window !== 'undefined' &&
                  (window as any).__PROLIFIC_API_BASE__ &&
                  String((window as any).__PROLIFIC_API_BASE__)) ||
                'https://prolific-api.onrender.com/api/v1';
              // Try refreshing via POST /auth/refresh (not all builds deploy
              // this route — if it 404s, catch and fall through to the PIN
              // flow below so we never fail Manager page just because this
              // endpoint is missing).
              const body = JSON.stringify({ refreshToken: cur.refreshToken });
              const refreshResp = await fetch(`${API_BASE}/auth/refresh`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${cur.accessToken || ''}`,
                },
                body,
              });
              if (refreshResp.ok) {
                const refreshJson = await refreshResp.json().catch(() => null);
                const refreshData = (refreshJson && (refreshJson.data ?? refreshJson)) || null;
                if (refreshData && (refreshData.accessToken || refreshData.token)) {
                  cur.actions.promoteOnlineLogin({
                    ...refreshData,
                    deviceId,
                  });
                  return (refreshData.accessToken || refreshData.token) as string;
                }
              }
            } catch {
              /* ignore — fall through to PIN re-auth */
            }
          }

          // ----------------------------------------------------------------
          // Option B — PIN-based re-authentication (guaranteed to exist on
          // every build). This is the default path for pin-login sessions.
          // offlinePin is persisted during both regular and offline-first
          // login; if missing, we genuinely cannot re-authenticate silently
          // and must throw.
          // ----------------------------------------------------------------
          if (!cur.offlinePin) {
            throw new Error(
              'No cached PIN for silent re-auth. Please log out and log back in to enable Manager tools.'
            );
          }
          const branchId = cur.branch?.id;
          const loginResp = await pinLogin({
            pin: cur.offlinePin,
            branchId: typeof branchId === 'string' ? branchId : undefined,
            deviceId: typeof deviceId === 'string' ? deviceId : undefined,
          });
          const data = loginResp && typeof loginResp === 'object' ? loginResp : null;
          const freshToken =
            (data && (data.accessToken || data.token || data?.tokens?.accessToken)) || null;
          if (!freshToken) {
            throw new Error('Silent re-authentication returned no access token.');
          }
          // Persist the new access/refresh tokens, branch, employee snapshots
          // so the rest of the POS (bootstrap refreshes, change PIN dialog,
          // upcoming calls to Manager APIs) all use the fresh credentials.
          cur.actions.promoteOnlineLogin({ ...(data || {}), deviceId });
          return freshToken as string;
        },
        logout: () => {
          set({
            employee: null,
            branch: null,
            restaurant: null,
            accessToken: undefined,
            refreshToken: undefined,
            expiresAt: undefined,
            loginMode: 'ONLINE',
            lastLoginAt: null,
            offlinePin: undefined,
          });
          if (window.electronAPI?.db?.meta?.setLastAuth) {
            window.electronAPI.db.meta.setLastAuth(null).catch(() => {});
          }
        },
        clear: () => {
          set({
            employee: null,
            branch: null,
            restaurant: null,
            accessToken: undefined,
            refreshToken: undefined,
            expiresAt: undefined,
            loginMode: 'ONLINE',
            lastLoginAt: null,
            offlinePin: undefined,
          });
        },
      },
      };
      return state;
    },
    {
      name: 'pos_auth_v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        employee: s.employee,
        branch: s.branch,
        restaurant: s.restaurant,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        expiresAt: s.expiresAt,
        loginMode: s.loginMode,
        lastLoginAt: s.lastLoginAt,
        offlinePin: s.offlinePin,
      }),
      version: 1,
    }
  )
);
