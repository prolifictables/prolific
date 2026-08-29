'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { apiPost, API_BASE_URL } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface LoginClientProps {
  apiUrl: string;
  socketUrl: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  user: any;
  employee?: any;
  restaurant?: any;
  branches?: any[];
  branch?: any;
}

export default function LoginClient({ apiUrl, socketUrl }: LoginClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const initFromStorage = useAuthStore((s) => s.initFromStorage);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const hasAuth = initFromStorage();
    if (hasAuth) {
      const redirect = searchParams.get('redirect') || '/dashboard';
      router.replace(redirect);
    }
  }, [initFromStorage, router, searchParams]);

  const validate = () => {
    const e: { email?: string; password?: string } = {};
    if (!email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Invalid email format';
    if (!password) e.password = 'Password is required';
    else if (password.length < 6) e.password = 'Password must be at least 6 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      // Branch selection has been removed from the login flow: the server
      // always auto-attaches the default branch on a successful login, so
      // the frontend never needs to prompt the user for a branch picker.
      const payload: any = { email: email.trim(), password };
      const res = await apiPost<LoginResponse>('/auth/login', payload, { skipAuth: true });

      setAuth({
        user: res.user,
        employee: res.employee || null,
        restaurant: res.restaurant || null,
        branch: res.branch || null,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken || null,
      });

      toast('Welcome back!', {
        description: `Signed in as ${res.user.firstName} ${res.user.lastName}`,
        variant: 'success',
      });

      const redirect = searchParams.get('redirect') || '/dashboard';
      setTimeout(() => router.replace(redirect), 400);
    } catch (err: any) {
      toast('Sign in failed', {
        description: err.message || 'Please check your credentials',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(249,115,22,0.25),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(99,102,241,0.3),transparent_50%)]" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
              <svg viewBox="0 0 32 32" className="h-7 w-7 text-white" fill="currentColor">
                <path d="M8 4h16l-2 24H10L8 4zm4 6v2h8v-2h-8zm0 5v2h8v-2h-8zm0 5v2h5v-2h-5z" opacity=".9" />
                <circle cx="24" cy="8" r="4" fill="#F97316" />
              </svg>
            </div>
            <div>
              <div className="text-white text-2xl font-bold tracking-tight">Prolific</div>
              <div className="text-white/60 text-sm font-medium">Admin Console</div>
            </div>
          </div>

          <div className="max-w-lg space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl font-bold text-white leading-[1.1] tracking-tight">
                Run your restaurant
                <span className="block text-accent-400">like clockwork.</span>
              </h1>
              <p className="text-white/70 text-lg leading-relaxed">
                One unified dashboard for orders, menu, inventory, staff, and real-time reporting across all your branches.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4">
              {[
                { label: 'Live Orders', value: 'Real-time' },
                { label: 'Insights', value: 'Data-driven' },
                { label: 'Control', value: 'Multi-branch' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl bg-white/8 backdrop-blur-sm border border-white/15 p-4">
                  <div className="text-white font-semibold">{item.value}</div>
                  <div className="text-white/50 text-xs mt-1">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-white/40 text-xs">
            Prolific Admin v1.0 · Secure access
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16 bg-slate-50">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-10 justify-center">
            <div className="h-11 w-11 rounded-xl bg-brand-600 flex items-center justify-center">
              <svg viewBox="0 0 32 32" className="h-6 w-6 text-white" fill="currentColor">
                <path d="M8 4h16l-2 24H10L8 4zm4 6v2h8v-2h-8zm0 5v2h8v-2h-8zm0 5v2h5v-2h-5z" opacity=".9" />
                <circle cx="24" cy="8" r="4" fill="#F97316" />
              </svg>
            </div>
            <div className="text-slate-900 text-xl font-bold">Prolific Admin</div>
          </div>

          <div className="bg-white rounded-3xl shadow-card border border-slate-100 p-8 space-y-7">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome back</h2>
              <p className="text-slate-500 text-sm">Sign in to your admin account to continue</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <Input
                label="Email address"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@prolific.restaurant"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
                prefix={
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M22 7l-10 6L2 7" />
                  </svg>
                }
              />
              <div>
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={errors.password}
                  prefix={
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                  }
                  suffix={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="pointer-events-auto text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a19.77 19.77 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 8 11 8a19.86 19.86 0 01-3.17 4.19m-2.21-2.21a3 3 0 01-4.24-4.24" />
                          <path d="M1 1l22 22" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  }
                />
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    defaultChecked
                  />
                  <span className="text-slate-600">Remember me</span>
                </label>
                <a href="#" className="text-brand-600 font-medium hover:text-brand-700">
                  Forgot password?
                </a>
              </div>

              <Button type="submit" size="lg" loading={loading} fullWidth className="!py-3">
                Sign in
              </Button>
            </form>
          </div>

          <p className="text-center text-slate-400 text-xs mt-8">
            API: {apiUrl || 'default'} · Secure connection required
          </p>
        </div>
      </div>
    </div>
  );
}
