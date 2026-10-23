"use client";

// Who's logged in, for every Client Component: const { user, login, logout } = useAuth()
//
// On page load it asks the API for a new access token with the refresh cookie. If that works,
// the visitor is still logged in from earlier; if not, they're a guest.
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshAccessToken, setAccessToken } from "@/lib/client-api";
import type { User } from "@/lib/types";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "guest"; user: null }
  | { status: "signed-in"; user: User };

// What the first login step answers: logged in, or "now enter your 2FA code"
export type LoginResult = { done: true } | { done: false; challengeToken: string };

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<LoginResult>;
  completeTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // Reads the user again (after changing the name, say), so every component shows it
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type SessionResponse = { data: { user: User; token: string } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  // A new session from login/register: keep the access token in memory, show the user
  const signIn = useCallback(({ data }: SessionResponse) => {
    setAccessToken(data.token);
    setState({ status: "signed-in", user: data.user });
  }, []);

  // Still logged in from an earlier visit?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await refreshAccessToken();
      const me = token ? await api<{ data: User }>("/auth/me").catch(() => null) : null;
      if (!cancelled) {
        setState(me ? { status: "signed-in", user: me.data } : { status: "guest", user: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const res = await api<SessionResponse | { data: { twoFactorRequired: true; challengeToken: string } }>(
      "/auth/login",
      { method: "POST", body: { email, password } }
    );
    if ("twoFactorRequired" in res.data) {
      return { done: false, challengeToken: res.data.challengeToken };
    }
    signIn(res as SessionResponse);
    return { done: true };
  }, [signIn]);

  const completeTwoFactor = useCallback(async (challengeToken: string, code: string) => {
    signIn(await api<SessionResponse>("/auth/login/2fa", { method: "POST", body: { challengeToken, code } }));
  }, [signIn]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    signIn(await api<SessionResponse>("/auth/register", { method: "POST", body: { name, email, password } }));
  }, [signIn]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setAccessToken(null);
    setState({ status: "guest", user: null });
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await api<{ data: User }>("/auth/me");
    setState({ status: "signed-in", user: me.data });
  }, []);

  const value = useMemo(
    () => ({ ...state, login, completeTwoFactor, register, logout, refreshUser }),
    [state, login, completeTwoFactor, register, logout, refreshUser]
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return value;
}
