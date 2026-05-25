/**
 * Minimal class-name combiner. Replaces `clsx` + `tailwind-merge` until those
 * dependencies are introduced; keeps Phase A dependency-free.
 */
export function cn(...inputs: Array<string | undefined | null | false>): string {
  return inputs.filter(Boolean).join(' ');
}
