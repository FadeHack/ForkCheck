"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/new", label: "New check" },
  { href: "/meetings", label: "Your meetings" },
] as const;

/**
 * The organizer's places. A participant's pages leave it out: they have no meetings of their own
 * here, only the one link they were sent.
 */
export function SiteNav() {
  const path = usePathname();
  if (path.startsWith("/p/")) return null;
  return (
    <nav aria-label="Main" className="site-nav">
      <ul>
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={path === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
