import { notFound } from 'next/navigation';
import { getRequestConfig, type GetRequestConfigParams } from 'next-intl/server';

import enMessages from '@quantumed/i18n/messages/en.json';
import arMessages from '@quantumed/i18n/messages/ar.json';
import amMessages from '@quantumed/i18n/messages/am.json';
import omMessages from '@quantumed/i18n/messages/om.json';
import soMessages from '@quantumed/i18n/messages/so.json';
import tiMessages from '@quantumed/i18n/messages/ti.json';

import { DEFAULT_LOCALE, type Locale, isLocale } from './locales';

// next-intl's `AbstractIntlMessages` is a recursive structure but our message
// catalogs are already shaped correctly. Cast through `unknown` to avoid
// describing the full recursive type by hand.
const MESSAGES = {
  en: enMessages,
  ar: arMessages,
  am: amMessages,
  om: omMessages,
  so: soMessages,
  ti: tiMessages,
} as const;

export default getRequestConfig(async ({ requestLocale }: GetRequestConfigParams) => {
  const requested = (await requestLocale) ?? DEFAULT_LOCALE;
  if (!isLocale(requested)) notFound();
  const locale: Locale = requested;
  const messages = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  return { locale, messages };
});
