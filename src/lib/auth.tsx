import { useEffect, useMemo, useState } from "react";
import { isNative, nativeGoogleSignIn } from "./native";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../supabase";

export type AuthState = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

export function useAuthState(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(() => {
    async function requireClient() {
      if (!supabase) {
        throw new Error("Supabase is not configured. Add your project keys first.");
      }
      return supabase;
    }

    return {
      user: session?.user ?? null,
      loading,
      configured: isSupabaseConfigured,
      async signInWithGoogle() {
        const client = await requireClient();
        if (isNative) {
          await nativeGoogleSignIn();
          return;
        }
        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
        // Supabase reports OAuth problems (e.g. provider not enabled) as a value: surface it
        if (error) throw error;
      },
      async signInWithPassword(email, password) {
        try {
          const client = await requireClient();
          const { error } = await client.auth.signInWithPassword({ email, password });
          return error ? error.message : null;
        } catch (error) {
          return error instanceof Error ? error.message : "Sign in failed.";
        }
      },
      async signUp(email, password) {
        try {
          const client = await requireClient();
          const { error } = await client.auth.signUp({ email, password });
          if (error) return error.message;
          return "Check your email to confirm your account, then sign in.";
        } catch (error) {
          return error instanceof Error ? error.message : "Sign up failed.";
        }
      },
      async signOut() {
        const client = await requireClient();
        await client.auth.signOut();
      },
    };
  }, [session, loading]);

  return value;
}

export function AuthGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { user, loading } = useAuthState();
  if (loading) return null;
  return <>{user ? children : fallback}</>;
}

export function Avatar({ user }: { user: User | null }) {
  const meta = user?.user_metadata ?? {};
  const name = (meta.full_name as string | undefined) || (meta.name as string | undefined) || user?.email || "?";
  const picture = meta.picture as string | undefined;
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  if (picture) {
    return <img className="avatar" src={picture} alt="" referrerPolicy="no-referrer" />;
  }
  return <span className="avatar avatar-initial">{initial}</span>;
}
