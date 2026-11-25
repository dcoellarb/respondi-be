import { normalizePhone } from "../account/validate";

/**
 * Meta often sends display_phone_number as digits without a leading +.
 * Normalize to the same E.164 form stored on PHONE# lookup items.
 */
export function normalizeWhatsAppBusinessPhone(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (!compact) return null;
  if (compact.startsWith("+")) return normalizePhone(compact);
  if (/^[1-9]\d{7,14}$/.test(compact)) return normalizePhone(`+${compact}`);
  return null;
}

/** Customer `messages[].from` → E.164 for conversation PK. */
export function normalizeWhatsAppCustomerPhone(value: string): string | null {
  return normalizeWhatsAppBusinessPhone(value);
}

/**
 * Business WhatsApp number from a Cloud API webhook payload
 * (entry[].changes[].value.metadata.display_phone_number).
 */
export function extractWhatsAppBusinessPhone(payload: unknown): string | null {
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
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
      const display = (metadata as { display_phone_number?: unknown }).display_phone_number;
      if (typeof display !== "string") continue;
      const phone = normalizeWhatsAppBusinessPhone(display);
      if (phone) return phone;
    }
  }
  return null;
}
