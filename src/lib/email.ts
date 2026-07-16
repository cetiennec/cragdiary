const TOOL_API = "https://api.nanocorp.so/internal/tools/send_email/execute";

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  const token = process.env.NANOCORP_TOKEN;
  const company = process.env.NANOCORP_COMPANY;
  if (!token || !company) {
    console.error("email: NANOCORP_TOKEN / NANOCORP_COMPANY not configured");
    return false;
  }

  try {
    const res = await fetch(TOOL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Nanocorp-Company": company,
      },
      body: JSON.stringify({ arguments: { to, subject, body: html } }),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as { success: boolean; error?: string };
    if (!data.success) {
      console.error("email: send failed:", data.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("email: request failed:", e);
    return false;
  }
}
