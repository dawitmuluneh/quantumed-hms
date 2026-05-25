import { ModuleStub } from '@/components/module-stub';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ModuleStub i18nKey="hr" routePath="/hr/attendance" locale={locale} phase="C" />;
}
