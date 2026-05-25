'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiFetch, readSession } from '@/lib/api-client';

interface Patient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string;
  sex: 'M' | 'F' | 'O' | 'U';
  phone?: string | null;
  email?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'DECEASED';
}

interface PatientsPage {
  data: Patient[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

interface CreateForm {
  firstName: string;
  lastName: string;
  dob: string;
  sex: 'M' | 'F' | 'O' | 'U';
  phone: string;
  email: string;
}

const EMPTY_FORM: CreateForm = {
  firstName: '',
  lastName: '',
  dob: '',
  sex: 'M',
  phone: '',
  email: '',
};

export function PatientsDashboard() {
  const t = useTranslations('dashboards.doctor.patients');
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    setSessionReady(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<PatientsPage>('/api/patients?pageSize=50');
      setPatients(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load patients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    if (!readSession()) {
      setError('Sign in first to load patients.');
      setLoading(false);
      return;
    }
    void load();
  }, [load, sessionReady]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<Patient>('/api/patients', {
        method: 'POST',
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          dob: form.dob,
          sex: form.sex,
          phone: form.phone || undefined,
          email: form.email || undefined,
        }),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code ?? 'ERROR'}: ${err.message}`);
      else setError(err instanceof Error ? err.message : 'Failed to register patient');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm text-white shadow hover:bg-brand-700"
          >
            {showForm ? t('cancel') : t('register')}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={onSubmit}
            className="mt-6 grid grid-cols-1 gap-4 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2"
          >
            <label className="text-sm">
              <span className="text-slate-700">{t('firstName')}</span>
              <input
                required
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-700">{t('lastName')}</span>
              <input
                required
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-700">{t('dob')}</span>
              <input
                required
                type="date"
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-700">{t('sex')}</span>
              <select
                value={form.sex}
                onChange={(e) => setForm({ ...form, sex: e.target.value as CreateForm['sex'] })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
              >
                <option value="M">M</option>
                <option value="F">F</option>
                <option value="O">O</option>
                <option value="U">U</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-slate-700">{t('phone')}</span>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-700">{t('email')}</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white shadow hover:bg-emerald-700 disabled:opacity-50"
              >
                {submitting ? '…' : t('submit')}
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-md border border-slate-200 bg-white">
          {loading ? (
            <div className="p-6 text-sm text-slate-600">…</div>
          ) : patients && patients.length > 0 ? (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('mrn')}</th>
                  <th className="px-4 py-2 font-medium">{t('name')}</th>
                  <th className="px-4 py-2 font-medium">{t('dob')}</th>
                  <th className="px-4 py-2 font-medium">{t('sex')}</th>
                  <th className="px-4 py-2 font-medium">{t('phone')}</th>
                  <th className="px-4 py-2 font-medium">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {patients.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{p.mrn}</td>
                    <td className="px-4 py-2">
                      {p.firstName} {p.lastName}
                    </td>
                    <td className="px-4 py-2">{p.dob}</td>
                    <td className="px-4 py-2">{p.sex}</td>
                    <td className="px-4 py-2 text-slate-600">{p.phone ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-6 text-sm text-slate-600">{t('noPatients')}</div>
          )}
        </div>
      </div>
    </main>
  );
}
