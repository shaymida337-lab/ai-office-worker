"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, register, saveToken } from "@/lib/auth";

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
    <div className="card" style={{ maxWidth: 400, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>{isSignup ? "הרשמה" : "התחברות"}</h2>
      <form onSubmit={handleSubmit}>
        {isSignup && (
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="name" style={{ display: "block", marginBottom: 4 }}>
              שם (אופציונלי)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              autoComplete="name"
            />
          </div>
        )}
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="email" style={{ display: "block", marginBottom: 4 }}>
            אימייל
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            autoComplete="email"
            dir="ltr"
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="password" style={{ display: "block", marginBottom: 4 }}>
            סיסמה {isSignup && <span style={{ color: "var(--muted)" }}>(מינימום 8 תווים)</span>}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={isSignup ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            autoComplete={isSignup ? "new-password" : "current-password"}
            dir="ltr"
          />
        </div>
        {error && (
          <p style={{ color: "var(--danger)", marginBottom: "1rem" }}>{error}</p>
        )}
        <button type="submit" className="btn" disabled={loading} style={{ width: "100%" }}>
          {loading ? "..." : isSignup ? "צור חשבון" : "התחבר"}
        </button>
      </form>
      <p style={{ marginTop: "1.5rem", color: "var(--muted)", fontSize: "0.9rem" }}>
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  borderRadius: 8,
  border: "1px solid #2a3548",
  background: "#0f1419",
  color: "var(--text)",
  fontSize: "1rem",
};
