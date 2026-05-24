"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const links = [
  { href: "/dashboard", label: "לוח בקרה" },
  { href: "/dashboard/clients", label: "לקוחות" },
  { href: "/payments", label: "תשלומי ספקים" },
  { href: "/camera", label: "צילום חשבונית" },
  { href: "/collections", label: "גבייה" },
  { href: "/social", label: "סושיאל" },
  { href: "/tasks", label: "משימות" },
  { href: "/reports", label: "דוחות" },
  { href: "/dashboard/whatsapp", label: "WhatsApp" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    localStorage.removeItem("token");
    router.push("/");
  }

  return (
    <nav>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={pathname === l.href ? "active" : ""}
        >
          {l.label}
        </Link>
      ))}
      <button type="button" onClick={logout}>
        התנתק
      </button>
    </nav>
  );
}
