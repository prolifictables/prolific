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
