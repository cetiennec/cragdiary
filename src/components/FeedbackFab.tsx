"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The floating "Feedback" button on every page — except the feedback page
// itself, where it only covered the form it was pointing at.
export default function FeedbackFab({ label, title }: { label: string; title: string }) {
  const path = usePathname();
  if (path === "/feedback") return null;
  return (
    <Link href="/feedback" className="feedback-fab" title={title}>
      💬 {label}
    </Link>
  );
}
