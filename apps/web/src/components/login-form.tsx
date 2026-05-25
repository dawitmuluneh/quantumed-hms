'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface Props {
  locale: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string; roles: string[] };
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export function LoginForm({ locale: _locale }: Props) {
  const t = useTranslations();
  const [email, setEmail] = useState('doctor@demo.com');
  const [password, setPassword] = useState('demo123');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LoginResponse | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, mfaCode: mfaCode || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? t('auth.login.errorInvalid'));
        return;
      }
      const data = (await res.json()) as LoginResponse;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-medium">Signed in as {result.user.fullName}</p>
        <p className="mt-1 text-emerald-800">Roles: {result.user.roles.join(', ') || 'none'}</p>
        <p className="mt-2 break-all text-xs text-emerald-700">
          Access token (first 40 chars): {result.accessToken.slice(0, 40)}…
        </p>
      </div>
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit}>
      <div>
        <label className="text-sm text-slate-700">{t('auth.login.email')}</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-sm text-slate-700">{t('auth.login.password')}</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-sm text-slate-700">{t('auth.login.mfaCode')}</label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value)}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-brand-600 px-4 py-2 text-white shadow hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? t('common.loading') : t('auth.login.submit')}
      </button>
    </form>
  );
}
