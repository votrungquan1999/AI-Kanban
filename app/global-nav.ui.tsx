"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Shared global navigation across surfaces, rendered as a tab bar: a Board tab
 * (`/`, exact-match active) and a Recurring tab (`/recurring`, exact-match
 * active). Each tab is a link; the active one carries `aria-current="page"`, a
 * colored bottom-border indicator, and tokenized emphasis. Client-only for the
 * `usePathname` active-state read; no data fetching.
 */
export function GlobalNav() {
  const pathname = usePathname();

  return (
    <nav className="grid grid-flow-col justify-start border-b border-border bg-background px-4 text-sm">
      <Link
        href="/"
        aria-current={pathname === "/" ? "page" : undefined}
        className={cn(
          "border-b-2 border-transparent px-3 py-2 text-muted-foreground transition-colors hover:text-foreground",
          pathname === "/" && "border-primary font-medium text-foreground",
        )}
      >
        Board
      </Link>
      <Link
        href="/recurring"
        aria-current={pathname === "/recurring" ? "page" : undefined}
        className={cn(
          "border-b-2 border-transparent px-3 py-2 text-muted-foreground transition-colors hover:text-foreground",
          pathname === "/recurring" &&
            "border-primary font-medium text-foreground",
        )}
      >
        Recurring
      </Link>
    </nav>
  );
}
