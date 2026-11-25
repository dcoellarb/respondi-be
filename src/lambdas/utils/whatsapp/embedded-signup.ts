import { normalizeWhatsAppBusinessPhone } from "./phone";

const DEFAULT_GRAPH_VERSION = "v21.0";

function graphVersion(): string {
  return process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
}

function graphUrl(path: string, query?: Record<string, string>): string {
  const base = `https://graph.facebook.com/${graphVersion()}${path}`;
  if (!query) return base;
  const params = new URLSearchParams(query);
  return `${base}?${params.toString()}`;
}

export class WhatsAppGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "WhatsAppGraphError";
  }
}

async function readGraphJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new WhatsAppGraphError(
      `Graph API returned non-JSON (${response.status})`,
      response.status,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WhatsAppGraphError("Graph API returned an invalid body", response.status);
  }
  return parsed as Record<string, unknown>;
}

function graphErrorMessage(body: Record<string, unknown>, fallback: string): string {
  const error = body.error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

/**
 * Exchange Embedded Signup `authResponse.code` for a customer business token.
 * The code expires in ~30 seconds — call immediately from the connect Lambda.
 */
export async function exchangeEmbeddedSignupCode(input: {
  appId: string;
  appSecret: string;
  code: string;
}): Promise<string> {
  const url = graphUrl("/oauth/access_token", {
    client_id: input.appId,
    client_secret: input.appSecret,
    code: input.code,
  });
  const response = await fetch(url, { method: "GET" });
  const body = await readGraphJson(response);
  if (!response.ok) {
    throw new WhatsAppGraphError(
      graphErrorMessage(body, "Failed to exchange Embedded Signup code"),
      response.status,
      "CODE_EXCHANGE_FAILED",
    );
  }
  const token = body.access_token;
  if (typeof token !== "string" || !token.trim()) {
    throw new WhatsAppGraphError(
      "Graph API did not return access_token",
      502,
      "CODE_EXCHANGE_FAILED",
    );
  }
  return token.trim();
}

/** Subscribe the Respondi app to webhooks on the customer's WABA / Messaging account. */
export async function subscribeWhatsAppApp(input: {
  wabaId: string;
  accessToken: string;
}): Promise<void> {
  const url = graphUrl(`/${encodeURIComponent(input.wabaId)}/subscribed_apps`);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  const body = await readGraphJson(response);
  if (!response.ok) {
    throw new WhatsAppGraphError(
      graphErrorMessage(body, "Failed to subscribe app to WhatsApp webhooks"),
      response.status,
      "SUBSCRIBE_FAILED",
    );
  }
}

/**
 * Register the business phone for Cloud API.
 * Skip for WhatsApp Business app coexistence onboarding (`skipRegister`).
 */
export async function registerWhatsAppPhoneNumber(input: {
  phoneNumberId: string;
  accessToken: string;
  pin: string;
}): Promise<void> {
  const url = graphUrl(`/${encodeURIComponent(input.phoneNumberId)}/register`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      pin: input.pin,
    }),
  });
  const body = await readGraphJson(response);
  if (!response.ok) {
    throw new WhatsAppGraphError(
      graphErrorMessage(body, "Failed to register WhatsApp phone number"),
      response.status,
      "REGISTER_FAILED",
    );
  }
}

/** Load display phone (E.164) for the connected Cloud API phone number id. */
export async function fetchWhatsAppDisplayPhone(input: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<string> {
  const url = graphUrl(`/${encodeURIComponent(input.phoneNumberId)}`, {
    fields: "display_phone_number,verified_name",
  });
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  const body = await readGraphJson(response);
  if (!response.ok) {
    throw new WhatsAppGraphError(
      graphErrorMessage(body, "Failed to load WhatsApp phone details"),
      response.status,
      "PHONE_LOOKUP_FAILED",
    );
  }
  const display = body.display_phone_number;
  if (typeof display !== "string" || !display.trim()) {
    throw new WhatsAppGraphError(
      "WhatsApp phone has no display_phone_number",
      502,
      "PHONE_LOOKUP_FAILED",
    );
  }
  const phoneE164 = normalizeWhatsAppBusinessPhone(display);
  if (!phoneE164) {
    throw new WhatsAppGraphError(
      `Could not normalize display_phone_number: ${display}`,
      502,
      "PHONE_LOOKUP_FAILED",
    );
  }
  return phoneE164;
}
