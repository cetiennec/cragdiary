"use client";

import { useEffect } from "react";
import { markNotificationsRead } from "@/app/actions";

// Marks all notifications read once the notifications page is opened, so the
// header badge clears on the next render.
export default function MarkNotificationsRead() {
  useEffect(() => {
    void markNotificationsRead();
  }, []);
  return null;
}
