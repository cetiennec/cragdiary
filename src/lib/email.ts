// Overridable so an email can be caught and read locally without a Resend key
// — an email nobody ever looks at is an email nobody has proofread.
const RESEND_API = process.env.RESEND_API_URL ?? "https://api.resend.com/emails";

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  /** Extra headers — `List-Unsubscribe` and friends, which belong to the
      message rather than to its body. */
  headers?: Record<string, string>
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Cragdiary <noreply@cragdiary.com>";
  // Sent from an address that cannot receive — cragdiary.com has no MX at the
  // root, so a reply to it bounces — but a reply should still reach someone.
  // The same public address the feedback form already goes to.
  const replyTo = process.env.FEEDBACK_EMAIL;
  if (!key) {
    console.error("email: RESEND_API_KEY not configured");
    return false;
  }

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(headers ? { headers } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error("email: send failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("email: request failed:", e);
    return false;
  }
}