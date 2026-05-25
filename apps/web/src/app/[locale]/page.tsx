import { Link } from '@/components/link';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { getTranslations } from 'next-intl/server';

export default async function MarketingHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return (
    <main className="flex-1">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-semibold text-lg text-brand-700">QuantuMed HMS</span>
          <div className="flex items-center gap-4">
            <LocaleSwitcher current={locale} />
            <Link
              href={`/${locale}/login`}
              className="rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700"
            >
              {t('marketing.hero.ctaSecondary')}
            </Link>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-6xl">
          {t('marketing.hero.title')}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-slate-600">
          {t('marketing.hero.subtitle')}
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href={`/${locale}/login`}
            className="rounded-md bg-brand-600 px-6 py-3 text-white shadow hover:bg-brand-700"
          >
            {t('marketing.hero.ctaPrimary')}
          </Link>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            'doctor',
            'patient',
            'pharmacy',
            'lab',
            'imaging',
            'hr',
            'telemedicine',
            'donor',
            'referrals',
          ].map((role) => (
            <div key={role} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm uppercase text-slate-500">{t('common.dashboard')}</div>
              <div className="mt-1 text-xl font-semibold">{t(`dashboards.${role}.title`)}</div>
            </div>
          ))}
        </div>
      </section>
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-500">
        QuantuMed HMS — Phase A foundation
      </footer>
    </main>
  );
}
