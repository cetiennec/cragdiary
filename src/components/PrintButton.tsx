"use client";

/** Opens the browser's print dialog; the page's print styles do the rest. */
export default function PrintButton({ label, className }: { label: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      {label}
    </button>
  );
}
