"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const links = [
  { href: "/dashboard", label: "\u05dc\u05d5\u05d7 \u05d1\u05e7\u05e8\u05d4" },
  { href: "/dashboard/clients", label: "\u05dc\u05e7\u05d5\u05d7\u05d5\u05ea" },
  { href: "/dashboard/invoices", label: "\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u{1F9FE}" },
  { href: "/dashboard/accountant", label: "\u05e8\u05d5\u05d0\u05d4 \u05d7\u05e9\u05d1\u05d5\u05df" },
  { href: "/dashboard/settings", label: "\u05d4\u05d2\u05d3\u05e8\u05d5\u05ea" },
  { href: "/payments", label: "\u05ea\u05e9\u05dc\u05d5\u05de\u05d9 \u05e1\u05e4\u05e7\u05d9\u05dd" },
  { href: "/camera", label: "\u05e6\u05d9\u05dc\u05d5\u05dd \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea" },
  { href: "/collections", label: "\u05d2\u05d1\u05d9\u05d9\u05d4" },
  { href: "/social", label: "\u05e1\u05d5\u05e9\u05d9\u05d0\u05dc" },
  { href: "/tasks", label: "\u05de\u05e9\u05d9\u05de\u05d5\u05ea" },
  { href: "/reports", label: "\u05d3\u05d5\u05d7\u05d5\u05ea" },
  { href: "/dashboard/whatsapp", label: "WhatsApp" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(href: string) {
    return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  }

  function logout() {
    localStorage.removeItem("token");
    router.push("/");
  }

  return (
    <nav>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={isActive(l.href) ? "active" : ""}>
          {l.label}
        </Link>
      ))}
      <button type="button" onClick={logout}>
        {"\u05d4\u05ea\u05e0\u05ea\u05e7"}
      </button>
    </nav>
  );
}
