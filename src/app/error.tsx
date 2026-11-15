"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";

// What a reader sees when a page throws — a sentence, a retry, and the way to
// tell us — instead of Next's blank "An error occurred" default. An error
// boundary has to be a client component, so the language comes from the
// <html lang> the layout set, not from the dictionary.
const COPY = {
  en: {
    title: "Something went wrong",
    text: "The page broke while loading. Trying again usually works; if it keeps happening, tell us.",
    retry: "Try again",
    feedback: "Tell us",
  },
  fr: {
    title: "Quelque chose a cassé",
    text: "La page a planté en chargeant. Réessayer suffit en général ; si ça persiste, dites-le-nous.",
    retry: "Réessayer",
    feedback: "Nous le dire",
  },
};

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const lang = useSyncExternalStore(
    () => () => {},
    (): keyof typeof COPY => (document.documentElement.lang === "fr" ? "fr" : "en"),
    () => "en"
  );
  useEffect(() => {
    console.error(error);
  }, [error]);
  const c = COPY[lang];
  return (
    <div className="page-container">
      <h1 className="page-title">{c.title}</h1>
      <p className="not-found-text">{c.text}</p>
      <p className="not-found-links">
        <button type="button" className="btn-primary" onClick={() => reset()}>
          {c.retry}
        </button>
        <Link href="/feedback" className="filter-clear">
          {c.feedback}
        </Link>
      </p>
    </div>
  );
}
