"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, register, saveToken } from "@/lib/auth";
import { Logo } from "@/components/Logo";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result =
        mode === "signup"
          ? await register({
              email,
              password,
              name: name.trim() || undefined,
            })
          : await login({ email, password });
      saveToken(result.token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <div className="card mx-auto max-w-md">
      <div className="mb-6 flex justify-center">
        <Logo size="lg" showSubtitle />
      </div>
      <h2>{isSignup ? "הרשמה" : "התחברות"}</h2>
      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        {isSignup && (
          <div>
            <label htmlFor="name">
              שם (אופציונלי)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
        )}
        <div>
          <label htmlFor="email">
            אימייל
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            dir="ltr"
          />
        </div>
        <div>
          <label htmlFor="password">
            סיסמה {isSignup && <span className="text-ink-muted">(מינימום 8 תווים)</span>}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={isSignup ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
            dir="ltr"
          />
        </div>
        {error && (
          <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-red-200">{error}</p>
        )}
        <button type="submit" className="btn w-full" disabled={loading}>
          {loading ? "..." : isSignup ? "צור חשבון" : "התחבר"}
        </button>
      </form>
      <p className="mt-6 text-sm text-ink-muted">
        {isSignup ? (
          <>
            כבר יש חשבון? <Link href="/login">התחבר</Link>
          </>
        ) : (
          <>
            אין חשבון? <Link href="/signup">הירשם</Link>
          </>
        )}
      </p>
    </div>
  );
}
