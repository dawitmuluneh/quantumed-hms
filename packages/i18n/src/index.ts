import en from '../messages/en.json';

/**
 * The English message catalog is the canonical source of truth for translation
 * keys. Other locales must mirror the same key shape.
 */
export const referenceCatalog = en;
export type MessageCatalog = typeof en;

export const LOCALES = ['en', 'ar', 'am', 'om', 'so', 'ti'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const RTL_LOCALES: readonly Locale[] = ['ar'];

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
