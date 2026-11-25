/**
 * Cloud API body for POST /{phone-number-id}/messages (text).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */
export interface WhatsAppTextMessagePayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: {
    preview_url: false;
    body: string;
  };
}

const MAX_WHATSAPP_TEXT = 4096;
const DEFAULT_GRAPH_VERSION = "v21.0";

export function buildWhatsAppTextMessage(
  to: string,
  body: string,
): WhatsAppTextMessagePayload {
  const trimmedTo = to.trim();
  const trimmedBody = body.trim().slice(0, MAX_WHATSAPP_TEXT);
  if (!trimmedTo) throw new Error("WhatsApp recipient is required");
  if (!trimmedBody) throw new Error("WhatsApp message body is empty");

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: trimmedTo,
    type: "text",
    text: {
      preview_url: false,
      body: trimmedBody,
    },
  };
}

/**
 * Sends a text message via WhatsApp Cloud API.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 */
export async function sendWhatsAppTextMessage(input: {
  phoneNumberId: string;
  accessToken: string;
  message: WhatsAppTextMessagePayload;
  graphApiVersion?: string;
}): Promise<{ messageId: string | null }> {
  const phoneNumberId = input.phoneNumberId.trim();
  if (!phoneNumberId) throw new Error("WhatsApp phone_number_id is required");

  const version =
    input.graphApiVersion?.trim() ||
    process.env.WHATSAPP_GRAPH_API_VERSION?.trim() ||
    DEFAULT_GRAPH_VERSION;
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.message),
  });

  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail =
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as { error?: { message?: unknown } }).error &&
      typeof (parsed as { error: { message?: unknown } }).error.message === "string"
        ? (parsed as { error: { message: string } }).error.message
        : raw.slice(0, 500) || response.statusText;
    throw new Error(`WhatsApp Cloud API send failed (${response.status}): ${detail}`);
  }

  const messageId =
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as { messages?: unknown }).messages) &&
    (parsed as { messages: Array<{ id?: unknown }> }).messages[0] &&
    typeof (parsed as { messages: Array<{ id?: unknown }> }).messages[0].id ===
      "string"
      ? ((parsed as { messages: Array<{ id: string }> }).messages[0].id as string)
      : null;

  return { messageId };
}
