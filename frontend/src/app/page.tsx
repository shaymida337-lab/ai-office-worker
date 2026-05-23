import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function HomePage() {
  return (
    <div className="container" style={{ paddingTop: "4rem", textAlign: "center" }}>
      <h1>AI Office Worker</h1>
      <p style={{ color: "var(--muted)", maxWidth: 480, margin: "1rem auto" }}>
        עוזר משרד חכם לעסקים בישראל — Gmail, חשבוניות, Drive, WhatsApp וסיכומים יומיים.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
        <Link className="btn" href="/login">
          התחברות באימייל
        </Link>
        <Link className="btn btn-secondary" href="/signup">
          הרשמה
        </Link>
      </div>
      <p style={{ marginTop: "1.25rem", fontSize: "0.9rem", color: "var(--muted)" }}>
        או{" "}
        <a href={`${API_URL}/auth/google`}>התחבר עם Google</a> (לחיבור Gmail)
      </p>
      <p style={{ marginTop: "1rem", fontSize: "0.9rem", color: "var(--muted)" }}>
        כבר מחובר? <Link href="/dashboard">לוח בקרה</Link>
      </p>
    </div>
  );
}
