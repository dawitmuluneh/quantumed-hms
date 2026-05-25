import { getTranslations } from 'next-intl/server';

import { LoginForm } from '@/components/login-form';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return (
    <main className="flex-1 flex items-center justify-center py-16 px-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">{t('auth.login.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('app.tagline')}</p>
        <LoginForm locale={locale} />
      </div>
    </main>
  );
}
