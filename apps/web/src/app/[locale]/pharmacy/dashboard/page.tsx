import { ModuleStub } from '@/components/module-stub';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <ModuleStub i18nKey="pharmacy" routePath="/pharmacy/dashboard" locale={locale} phase="C" />
  );
}
