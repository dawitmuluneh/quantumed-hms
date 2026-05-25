'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { LOCALES } from '@/i18n/locales';

interface Props {
  current: string;
}

export function LocaleSwitcher({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: string): void {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] && (LOCALES as readonly string[]).includes(segments[0])) {
      segments[0] = next;
    } else {
      segments.unshift(next);
    }
    const target = '/' + segments.join('/');
    startTransition(() => {
      router.replace(target);
    });
  }

  return (
    <label className="text-sm text-slate-600">
      <span className="sr-only">Language</span>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
        value={current}
        disabled={isPending}
        onChange={(e) => switchTo(e.target.value)}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {l.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
