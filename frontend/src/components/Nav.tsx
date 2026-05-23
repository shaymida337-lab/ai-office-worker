"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "לוח בקרה" },
  { href: "/payments", label: "תשלומי ספקים" },
  { href: "/camera", label: "צילום חשבונית" },
  { href: "/collections", label: "גבייה" },
  { href: "/social", label: "סושיאל" },
  { href: "/tasks", label: "משימות" },
  { href: "/reports", label: "דוחות" },
];

export function Nav() {
  const pathname = usePathname();
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
    </nav>
  );
}
