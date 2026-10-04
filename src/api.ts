let parentToken: string | null = sessionStorage.getItem('parentToken');

export function setParentToken(token: string | null) {
  parentToken = token;
  try {
    if (token) sessionStorage.setItem('parentToken', token);
    else sessionStorage.removeItem('parentToken');
  } catch {
    /* private mode */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onParentExpired: () => void = () => {};
export function onParentRequired(fn: () => void) {
  onParentExpired = fn;
}

let onDeviceUnpaired: () => void = () => {};
/** Called when the server says this device isn't (or is no longer) paired. */
export function onUnpaired(fn: () => void) {
  onDeviceUnpaired = fn;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (parentToken) headers['x-parent-token'] = parentToken;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.code === 'pair') {
      setParentToken(null);
      onDeviceUnpaired();
    } else if (res.status === 401) {
      setParentToken(null);
      onParentExpired();
    }
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const get = <T,>(p: string) => api<T>('GET', p);
export const post = <T,>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T,>(p: string, b: unknown) => api<T>('PUT', p, b);
export const patch = <T,>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const del = <T,>(p: string) => api<T>('DELETE', p);
