export interface WhatsAppInboundText {
  text: string;
  /** Customer WhatsApp id / phone as Meta sends it (usually digits, no +). */
  from: string;
  /** Business phone number id from metadata — required to send via Cloud API. */
  phoneNumberId: string;
}

/**
 * First inbound text message from a WhatsApp Cloud API webhook payload.
 * Ignores status-only and non-text messages.
 */
export function extractWhatsAppInboundText(
  payload: unknown,
): WhatsAppInboundText | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const entry = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entry)) return null;

  for (const item of entry) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const changes = (item as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== "object" || Array.isArray(change)) continue;
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const metadata = (value as { metadata?: unknown }).metadata;
      let phoneNumberId = "";
      if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
        const id = (metadata as { phone_number_id?: unknown }).phone_number_id;
        if (typeof id === "string" && id.trim()) phoneNumberId = id.trim();
      }
      const messages = (value as { messages?: unknown }).messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        if (!message || typeof message !== "object" || Array.isArray(message)) continue;
        const typed = message as { type?: unknown; text?: unknown; from?: unknown };
        if (typed.type !== "text") continue;
        if (typeof typed.from !== "string" || !typed.from.trim()) continue;
        const text = typed.text;
        if (!text || typeof text !== "object" || Array.isArray(text)) continue;
        const body = (text as { body?: unknown }).body;
        if (typeof body !== "string") continue;
        const trimmed = body.trim();
        if (!trimmed) continue;
        if (!phoneNumberId) return null;
        return {
          text: trimmed,
          from: typed.from.trim(),
          phoneNumberId,
        };
      }
    }
  }
  return null;
}

/** @deprecated Prefer extractWhatsAppInboundText */
export function extractWhatsAppTextMessage(payload: unknown): string | null {
  return extractWhatsAppInboundText(payload)?.text ?? null;
}
