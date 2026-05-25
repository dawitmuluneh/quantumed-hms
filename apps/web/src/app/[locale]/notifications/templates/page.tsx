import { ModuleStub } from '@/components/module-stub';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <ModuleStub
      title="Notification Templates"
      routePath="/notifications/templates"
      locale={locale}
      phase="C"
    />
  );
}
