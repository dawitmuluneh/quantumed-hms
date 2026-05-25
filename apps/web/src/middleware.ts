import createMiddleware from 'next-intl/middleware';

import { DEFAULT_LOCALE, LOCALES } from './i18n/locales';

export default createMiddleware({
  locales: LOCALES as unknown as string[],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
});

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
