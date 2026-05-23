import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export default function SignupPage() {
  return (
    <div className="container" style={{ paddingTop: "3rem" }}>
      <h1 style={{ textAlign: "center" }}>AI Office Worker</h1>
      <AuthForm mode="signup" />
      <p style={{ textAlign: "center", marginTop: "2rem" }}>
        <Link href="/">חזרה לדף הבית</Link>
      </p>
    </div>
  );
}
