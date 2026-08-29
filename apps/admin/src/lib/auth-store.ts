'use client';

import { create } from 'zustand';
import type { User, Employee, Restaurant, Branch, Role } from '@prolific/shared-types';

interface AuthState {
  user: User | null;
  employee: Employee | null;
  restaurant: Restaurant | null;
  branch: Branch | null;
  accessToken: string | null;
  refreshToken: string | null;
  approvalToken: string | null;
  approvalTokenExpiresAt: number | null;
  setAuth: (data: {
    user: User;
    employee?: Employee | null;
    restaurant?: Restaurant | null;
    branch?: Branch | null;
    accessToken: string;
    refreshToken?: string | null;
  }) => void;
  clearAuth: () => void;
  initFromStorage: () => boolean;
  setApprovalToken: (token: string, ttlSeconds?: number) => void;
  hasValidApprovalToken: () => boolean;
  getRole: () => Role | null;
}

const STORAGE_KEYS = {
  USER: 'auth_user',
  EMPLOYEE: 'auth_employee',
  RESTAURANT: 'auth_restaurant',
  BRANCH: 'auth_branch',
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
};

const setCookie = (name: string, value: string, days = 30) => {
  if (typeof document === 'undefined') return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
};

const deleteCookie = (name: string) => {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  employee: null,
  restaurant: null,
  branch: null,
  accessToken: null,
  refreshToken: null,
  approvalToken: null,
  approvalTokenExpiresAt: null,

  setAuth: (data) => {
    const { user, employee, restaurant, branch, accessToken, refreshToken } = data;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      window.localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
      setCookie('access_token', accessToken);
      if (employee) window.localStorage.setItem(STORAGE_KEYS.EMPLOYEE, JSON.stringify(employee));
      if (restaurant) window.localStorage.setItem(STORAGE_KEYS.RESTAURANT, JSON.stringify(restaurant));
      if (branch) window.localStorage.setItem(STORAGE_KEYS.BRANCH, JSON.stringify(branch));
      if (refreshToken) {
        window.localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
        setCookie('refresh_token', refreshToken);
      }
    }
    set({
      user,
      employee: employee || null,
      restaurant: restaurant || null,
      branch: branch || null,
      accessToken,
      refreshToken: refreshToken || null,
    });
  },

  clearAuth: () => {
    if (typeof window !== 'undefined') {
      Object.values(STORAGE_KEYS).forEach((k) => window.localStorage.removeItem(k));
      deleteCookie('access_token');
      deleteCookie('refresh_token');
    }
    set({
      user: null,
      employee: null,
      restaurant: null,
      branch: null,
      accessToken: null,
      refreshToken: null,
      approvalToken: null,
      approvalTokenExpiresAt: null,
    });
  },

  initFromStorage: () => {
    if (typeof window === 'undefined') return false;
    const accessToken = window.localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    if (!accessToken) return false;
    try {
      const userStr = window.localStorage.getItem(STORAGE_KEYS.USER);
      const empStr = window.localStorage.getItem(STORAGE_KEYS.EMPLOYEE);
      const restStr = window.localStorage.getItem(STORAGE_KEYS.RESTAURANT);
      const branchStr = window.localStorage.getItem(STORAGE_KEYS.BRANCH);
      const refreshToken = window.localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      set({
        user: userStr ? JSON.parse(userStr) : null,
        employee: empStr ? JSON.parse(empStr) : null,
        restaurant: restStr ? JSON.parse(restStr) : null,
        branch: branchStr ? JSON.parse(branchStr) : null,
        accessToken,
        refreshToken,
      });
      return true;
    } catch {
      get().clearAuth();
      return false;
    }
  },

  setApprovalToken: (token, ttlSeconds = 60) => {
    set({
      approvalToken: token,
      approvalTokenExpiresAt: Date.now() + ttlSeconds * 1000,
    });
  },

  hasValidApprovalToken: () => {
    const { approvalToken, approvalTokenExpiresAt } = get();
    if (!approvalToken || !approvalTokenExpiresAt) return false;
    return Date.now() < approvalTokenExpiresAt;
  },

  getRole: () => {
    const { employee } = get();
    return employee?.role || null;
  },
}));
