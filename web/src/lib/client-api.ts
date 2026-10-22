// Calling the API from the BROWSER (Client Components), as the logged-in user.
//
// The access token lives only in this module's memory: not in localStorage, where any script
// on the page (an XSS bug, a bad npm package) could read it. A page reload forgets it, and
// the httpOnly refresh cookie (which page scripts can't read) gets a new one.
import type { ApiError } from "./types";

let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

// An API error with the details the server sent (e.g. which form field was wrong)
export class ApiRequestError extends Error {
  status: number;
  fieldErrors: Array<{ field: string; message: string }>;

  constructor(status: number, body: Partial<ApiError>) {
    super(body.message ?? `Request failed (${status})`);
    this.status = status;
    this.fieldErrors = body.errors ?? [];
  }
}

// One refresh at a time. If several requests find their token expired together, they all
// wait for the SAME refresh: two refreshes with one cookie would look like a stolen token
// to the server (refresh-token reuse), and end the session.
let refreshing: Promise<string | null> | null = null;

export const refreshAccessToken = (): Promise<string | null> => {
  refreshing ??= (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch("/api/auth/refresh", { method: "POST" });
        if (res.status === 409) {
          // Another tab refreshed this session a moment ago; its new cookie is now ours too
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        const body = await res.json().catch(() => ({}));
        accessToken = res.ok ? body.data.token : null;
        return accessToken;
      }
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

type Options = Omit<RequestInit, "body"> & { body?: unknown };

// fetch("/api" + path) with JSON in and out. Sends the access token if there is one; on a
// 401 it refreshes once and tries again. Throws ApiRequestError for any non-2xx answer.
export const api = async <T = unknown>(path: string, { body, headers, ...init }: Options = {}): Promise<T> => {
  const send = () =>
    fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await send();
  if (res.status === 401 && accessToken && (await refreshAccessToken())) {
    res = await send();
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(res.status, json);
  }
  return json as T;
};
