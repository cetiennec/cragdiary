"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteEntry } from "@/app/actions";

export default function DeleteEntryButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="delete-btn"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this entry? This cannot be undone.")) return;
        const formData = new FormData();
        formData.set("id", id);
        startTransition(async () => {
          await deleteEntry(formData);
          router.refresh();
        });
      }}
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
