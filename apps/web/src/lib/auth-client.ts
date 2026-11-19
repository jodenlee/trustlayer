export interface BackendSession {
  address: string;
  chainId: number;
  expiresAt: string;
}
export interface BackendProfile {
  wallet_address: string;
  display_name: string;
  biography: string;
}
export function sessionMatches(
  session: BackendSession | null,
  address?: string,
  chainId?: number,
  now = Date.now(),
) {
  return (
    !!session &&
    !!address &&
    session.address.toLowerCase() === address.toLowerCase() &&
    session.chainId === chainId &&
    Date.parse(session.expiresAt) > now
  );
}
export async function backendRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error?.message ??
        "The backend request failed. Retry after checking setup.",
    );
  return result as T;
}
