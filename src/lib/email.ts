const RESEND_API = "https://api.resend.com/emails";

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Cragdiary <noreply@cragdiary.com>";
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
      body: JSON.stringify({ from, to, subject, html }),
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