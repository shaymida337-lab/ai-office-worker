import { clearAllAuthTokens } from "./api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AuthResponse = {
  token: string;
  user: { id: string; email: string; name: string | null };
  organization: { id: string; name: string };
};

export function saveToken(token: string): void {
  if (typeof window === "undefined") return;
  clearAllAuthTokens();
  localStorage.setItem("token", token.trim());
  localStorage.setItem("tenantCacheEpoch", String(Date.now()));
}

export async function register(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("אי אפשר להתחבר לשרת כרגע. נסה שוב בעוד רגע.");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "ההרשמה נכשלה");
  return data as AuthResponse;
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("אי אפשר להתחבר לשרת כרגע. נסה שוב בעוד רגע.");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "ההתחברות נכשלה");
  return data as AuthResponse;
}
