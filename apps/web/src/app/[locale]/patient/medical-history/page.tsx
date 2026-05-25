import { ModuleStub } from '@/components/module-stub';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <ModuleStub i18nKey="patient" routePath="/patient/medical-history" locale={locale} phase="C" />
  );
}
