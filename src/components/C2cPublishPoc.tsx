"use client";

import { useState, useTransition } from "react";
import {
  previewC2cOuting,
  publishToC2c,
  unpublishFromC2c,
  type PublishResult,
} from "@/app/actions";

/**
 * Publishing a day to camptocamp — proof of concept, shown to beta testers
 * and nobody else (the admin, plus the list on /admin — see lib/beta.ts). The
 * enquiry behind it is in `docs/publier-sur-camptocamp.md`.
 *
 * Deliberately unlovely, and deliberately not translated: a handful of people
 * see it, and it is here to find out whether the thing works at all before it
 * is worth a design or a second language.
 *
 * Two things it insists on, both because camptocamp lets the author delete an
 * outing for **24 hours only**:
 *
 *   - preview first, showing the exact document that would be sent;
 *   - the password typed for each attempt, never stored, never remembered.
 */
export default function C2cPublishPoc({
  entryId,
  publishedId,
  hasRoute,
}: {
  entryId: string;
  publishedId: number | null;
  /** No c2c route on the day means camptocamp would refuse it outright. */
  hasRoute: boolean;
}) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<PublishResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (data: FormData) => Promise<PublishResult>, withPassword: boolean) {
    const data = new FormData();
    data.set("entry_id", entryId);
    if (withPassword) {
      data.set("c2c_user", user);
      data.set("c2c_password", password);
    }
    startTransition(async () => {
      const r = await action(data);
      setResult(r);
      // Whatever happened, the password does not stay sitting in the page.
      setPassword("");
    });
  }

  return (
    <details className="profile-settings c2c-publish">
      <summary>🏔️ Publish on camptocamp — proof of concept</summary>

      <p className="form-hint">
        Beta. Camptocamp lets you delete your own outing for <strong>24 hours</strong>;
        after that only a moderator can. Preview first. Photos are not published by this
        proof of concept.
      </p>

      {publishedId ? (
        <>
          <p className="form-hint">
            Published as{" "}
            <a
              href={`https://www.camptocamp.org/outings/${publishedId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              outing {publishedId}
            </a>
            .
          </p>
          <div className="c2c-publish-creds">
            <input
              type="text"
              placeholder="camptocamp login"
              autoComplete="off"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
            <input
              type="password"
              placeholder="camptocamp password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="follower-remove"
              disabled={pending || !user || !password}
              onClick={() => run(unpublishFromC2c, true)}
            >
              Take it down
            </button>
          </div>
        </>
      ) : (
        <>
          {!hasRoute && (
            <p className="form-hint">
              This day has no camptocamp route, and an outing must be attached to one — add
              the route above and save first.
            </p>
          )}
          <div className="c2c-publish-creds">
            <button
              type="button"
              className="follow-back"
              disabled={pending}
              onClick={() => run(previewC2cOuting, false)}
            >
              Preview what would be sent
            </button>
          </div>
          <div className="c2c-publish-creds">
            <input
              type="text"
              placeholder="camptocamp login"
              autoComplete="off"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
            <input
              type="password"
              placeholder="camptocamp password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="follower-accept"
              disabled={pending || !user || !password || !hasRoute}
              onClick={() => run(publishToC2c, true)}
            >
              Publish for real
            </button>
          </div>
        </>
      )}

      {pending && <p className="form-hint">Talking to camptocamp…</p>}

      {result?.error && <p className="form-error">{result.error}</p>}
      {result?.ok && result.url && (
        <p className="form-hint">
          Published:{" "}
          <a href={result.url} target="_blank" rel="noopener noreferrer">
            {result.url}
          </a>
        </p>
      )}
      {result?.ok && !result.url && !result.payload && <p className="form-hint">Done.</p>}
      {result?.warnings && result.warnings.length > 0 && (
        <ul className="form-hint c2c-publish-warnings">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {result?.payload != null && (
        <pre className="c2c-publish-payload">{JSON.stringify(result.payload, null, 2)}</pre>
      )}
    </details>
  );
}
