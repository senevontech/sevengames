import { useState } from "react";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import type { AuthState } from "../lib/auth";

export default function AuthForm({
  auth,
  redirectTo,
}: {
  auth: AuthState;
  redirectTo: string;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    // Store intended destination so the OAuth/email callback returns here
    window.sessionStorage.setItem("7games:redirect", redirectTo);

    const result =
      mode === "signin"
        ? await auth.signInWithPassword(email, password)
        : await auth.signUp(email, password);
    setBusy(false);

    if (result) setMessage(result);
  }

  async function google() {
    setBusy(true);
    setMessage("");
    window.sessionStorage.setItem("7games:redirect", redirectTo);
    try {
      // On success the browser leaves for Google, so `busy` only needs resetting on failure.
      await auth.signInWithGoogle();
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Google sign-in failed.");
    }
  }

  return (
    <div className="lg-form">
      <div className="lg-toggle" role="tablist" aria-label="Sign in or create an account">
        <span className={`lg-toggle-thumb${mode === "signup" ? " is-right" : ""}`} aria-hidden="true" />
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          className={mode === "signin" ? "on" : ""}
          onClick={() => {
            setMode("signin");
            setMessage("");
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          className={mode === "signup" ? "on" : ""}
          onClick={() => {
            setMode("signup");
            setMessage("");
          }}
        >
          Create account
        </button>
      </div>

      <button type="button" className="lg-google" onClick={google} disabled={busy}>
        <GoogleMark />
        Continue with Google
      </button>

      <div className="lg-divider">
        <span>or with email</span>
      </div>

      <form onSubmit={submit} className="lg-fields">
        <label className="lg-field">
          <Mail size={17} aria-hidden="true" />
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            aria-label="Email"
          />
        </label>
        <label className="lg-field">
          <Lock size={17} aria-hidden="true" />
          <input
            type={showPw ? "text" : "password"}
            required
            minLength={6}
            placeholder={mode === "signup" ? "Password (6+ characters)" : "Password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            aria-label="Password"
          />
          <button
            type="button"
            className="lg-eye"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
            title={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </label>
        <button className="ac-btn ac-btn-primary lg-submit" type="submit" disabled={busy}>
          {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      {message ? (
        <p className="lg-message" role="status">
          {message}
        </p>
      ) : null}
      {!auth.configured ? (
        <p className="lg-message is-muted">Supabase isn’t configured yet — add your keys to `.env.local` (see README).</p>
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z"
      />
    </svg>
  );
}
