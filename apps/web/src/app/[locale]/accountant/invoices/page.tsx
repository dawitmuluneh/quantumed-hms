import { ModuleStub } from '@/components/module-stub';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ModuleStub title="Invoices" routePath="/accountant/invoices" locale={locale} phase="C" />;
}
