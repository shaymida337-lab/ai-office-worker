const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type AuthResponse = {
  token: string;
  user: { id: string; email: string; name: string | null };
  organization: { id: string; name: string };
};

export function saveToken(token: string): void {
  if (!token.trim()) throw new Error("Missing auth token");
  localStorage.setItem("token", token);
  sessionStorage.setItem("token", token);
  localStorage.removeItem("authToken");
  sessionStorage.removeItem("authToken");
  localStorage.removeItem("accessToken");
  sessionStorage.removeItem("accessToken");
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
  if (!data.token) throw new Error("השרת לא החזיר token להתחברות");
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
  if (!data.token) throw new Error("השרת לא החזיר token להתחברות");
  return data as AuthResponse;
}
