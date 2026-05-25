import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { LOCALES, isLocale, localeDirection } from '@/i18n/locales';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'QuantuMed HMS',
  description: 'Cloud-native multi-tenant hospital management platform',
};

export function generateStaticParams(): Array<{ locale: string }> {
  return LOCALES.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = await getMessages({ locale });
  const dir = localeDirection(locale);
  return (
    <html lang={locale} dir={dir}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <div className="min-h-screen flex flex-col">{children}</div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
