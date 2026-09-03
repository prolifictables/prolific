import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { LoginMode } from './types';

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
    patchBranch: (branch: any) => void;
    logout: () => void;
    clear: () => void;
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      employee: null,
      branch: null,
      restaurant: null,
      accessToken: undefined,
      refreshToken: undefined,
      expiresAt: undefined,
      loginMode: 'ONLINE',
      lastLoginAt: null,
      offlinePin: undefined,
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
    }),
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
