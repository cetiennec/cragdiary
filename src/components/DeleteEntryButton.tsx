"use client";

import { useTransition } from "react";
import { deleteEntry } from "@/app/actions";

export default function DeleteEntryButton({
  id,
  labels,
}: {
  id: string;
  labels: { delete: string; deleting: string; confirm: string };
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="delete-btn"
      disabled={pending}
      onClick={() => {
        if (!confirm(labels.confirm)) return;
        const formData = new FormData();
        formData.set("id", id);
        startTransition(async () => {
          await deleteEntry(formData);
        });
      }}
    >
      {pending ? labels.deleting : labels.delete}
    </button>
  );
}
