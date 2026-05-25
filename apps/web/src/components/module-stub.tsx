import { getTranslations } from 'next-intl/server';

interface Props {
  /** i18n key under `dashboards.<key>.title`, or fallback literal title */
  i18nKey?: string;
  title?: string;
  subtitle?: string;
  routePath: string;
  phase?: 'A' | 'B' | 'C' | 'D' | 'E';
  locale: string;
}

/**
 * Placeholder page for routes that the action plan mandates verbatim but that
 * will be implemented in a later phase. Documents the route in the running
 * app so users can see the surface area without hitting 404s.
 */
export async function ModuleStub({
  i18nKey,
  title,
  subtitle,
  routePath,
  phase = 'C',
  locale,
}: Props) {
  const t = await getTranslations({ locale });
  const heading = title ?? (i18nKey ? t(`dashboards.${i18nKey}.title`) : routePath);
  return (
    <main className="flex-1 px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <nav className="text-sm text-slate-500">
          <a href={`/${locale}`} className="hover:underline">
            QuantuMed HMS
          </a>
          <span className="mx-2">/</span>
          <span>{routePath}</span>
        </nav>
        <h1 className="mt-4 text-3xl font-semibold">{heading}</h1>
        {subtitle && <p className="mt-2 text-slate-600">{subtitle}</p>}
        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-medium">Phase {phase} surface — scaffolded</p>
          <p className="mt-1">
            This route is preserved verbatim per the QuantuMed action plan. The full UI ships in
            Phase {phase}. The Phase A foundation (this PR) wires up the route, RBAC matrix, and
            navigation — no real domain logic yet.
          </p>
          <p className="mt-2">
            Path: <code className="rounded bg-amber-100 px-1">{routePath}</code>
          </p>
        </div>
      </div>
    </main>
  );
}
