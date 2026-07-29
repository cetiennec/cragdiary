"use client";

import { useRef } from "react";

// A GET filter form that applies itself: picking a year (or any <select>) submits
// immediately, so there's no "now press Filter" step. Text fields still wait for
// Enter — submitting on every keystroke would navigate mid-word.
export default function AutoFilterForm({
  action,
  className,
  children,
}: {
  action: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      method="get"
      action={action}
      className={className}
      onChange={(e) => {
        const el = e.target as HTMLElement;
        // Also covers the native ✕ on a search field, which clears it in one click.
        const cleared =
          el instanceof HTMLInputElement && el.type === "search" && el.value === "";
        if (el.tagName === "SELECT" || cleared) ref.current?.requestSubmit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          ref.current?.requestSubmit();
        }
      }}
    >
      {children}
    </form>
  );
}
