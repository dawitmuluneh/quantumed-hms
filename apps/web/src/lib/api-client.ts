/**
 * Minimal API client for the QuantuMed web app. Reads auth + tenant context
 * from `sessionStorage` (populated by the login form). All requests are
 * scoped to the current tenant via the `X-Tenant-Id` header.
 *
 * Phase B.1 keeps this dependency-free; full SWR / React Query integration
 * comes in Phase C alongside the role dashboards.
 */

const SESSION_KEY = 'quantumed.session';
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export interface ClientSession {
  accessToken: string;
  refreshToken: string;
  hospitalSlug: string;
  user: { id: string; email: string; fullName: string; roles: string[] };
}

export function readSession(): ClientSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClientSession;
  } catch {
    return null;
  }
}

export function writeSession(session: ClientSession): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = readSession();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }
  if (session?.hospitalSlug) {
    headers.set('X-Tenant-Id', session.hospitalSlug);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let code: string | undefined;
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      message = body.error?.message ?? message;
      code = body.error?.code;
    } catch {
      // body wasn't JSON; keep the default message
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
