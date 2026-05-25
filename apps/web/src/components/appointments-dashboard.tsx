'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiFetch, readSession } from '@/lib/api-client';

interface Appointment {
  id: string;
  patientId: string;
  providerUserId: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  reason?: string | null;
}

interface BookForm {
  patientId: string;
  providerUserId: string;
  scheduledStart: string;
  scheduledEnd: string;
  reason: string;
}

const EMPTY_FORM: BookForm = {
  patientId: '',
  providerUserId: '',
  scheduledStart: '',
  scheduledEnd: '',
  reason: '',
};

export function AppointmentsDashboard() {
  const t = useTranslations('dashboards.doctor.appointments');
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<BookForm>(EMPTY_FORM);
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
      const result = await apiFetch<Appointment[]>('/api/appointments');
      setAppts(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const session = readSession();
    if (!session) {
      setError('Sign in first to load appointments.');
      setLoading(false);
      return;
    }
    setForm((f) => ({ ...f, providerUserId: f.providerUserId || session.user.id }));
    void load();
  }, [load, sessionReady]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<Appointment>('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patientId: form.patientId,
          providerUserId: form.providerUserId,
          scheduledStart: new Date(form.scheduledStart).toISOString(),
          scheduledEnd: new Date(form.scheduledEnd).toISOString(),
          reason: form.reason || undefined,
        }),
      });
      setForm({ ...EMPTY_FORM, providerUserId: form.providerUserId });
      setShowForm(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code ?? 'ERROR'}: ${err.message}`);
      else setError(err instanceof Error ? err.message : 'Failed to book appointment');
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
            {showForm ? t('cancel') : t('book')}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={onSubmit}
            className="mt-6 grid grid-cols-1 gap-4 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2"
          >
            <label className="text-sm">
              <span className="text-slate-700">{t('patientId')}</span>
              <input
                required
                value={form.patientId}
                onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-700">{t('providerUserId')}</span>
              <input
                required
                value={form.providerUserId}
                onChange={(e) => setForm({ ...form, providerUserId: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-700">{t('scheduledStart')}</span>
              <input
                required
                type="datetime-local"
                value={form.scheduledStart}
                onChange={(e) => setForm({ ...form, scheduledStart: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-700">{t('scheduledEnd')}</span>
              <input
                required
                type="datetime-local"
                value={form.scheduledEnd}
                onChange={(e) => setForm({ ...form, scheduledEnd: e.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-slate-700">{t('reason')}</span>
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
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
          ) : appts && appts.length > 0 ? (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('scheduledStart')}</th>
                  <th className="px-4 py-2 font-medium">{t('scheduledEnd')}</th>
                  <th className="px-4 py-2 font-medium">{t('patient')}</th>
                  <th className="px-4 py-2 font-medium">{t('provider')}</th>
                  <th className="px-4 py-2 font-medium">{t('reason')}</th>
                  <th className="px-4 py-2 font-medium">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {appts.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">{new Date(a.scheduledStart).toLocaleString()}</td>
                    <td className="px-4 py-2">{new Date(a.scheduledEnd).toLocaleString()}</td>
                    <td className="px-4 py-2 font-mono text-xs">{a.patientId.slice(0, 8)}…</td>
                    <td className="px-4 py-2 font-mono text-xs">{a.providerUserId.slice(0, 8)}…</td>
                    <td className="px-4 py-2 text-slate-600">{a.reason ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-6 text-sm text-slate-600">{t('noAppointments')}</div>
          )}
        </div>
      </div>
    </main>
  );
}
