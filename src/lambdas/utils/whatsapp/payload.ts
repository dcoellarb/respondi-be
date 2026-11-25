/**
 * Minimal check that the POST body matches a WhatsApp Cloud API webhook.
 * Extra fields (e.g. isSimulation, startClean) are allowed for Respondi test harnesses.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
export function isWhatsAppWebhookPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (payload.object !== "whatsapp_business_account") return false;
  if (!Array.isArray(payload.entry)) return false;
  return true;
}

/**
 * Respondi-only flag on test POSTs. Meta never sends this; when true, skip Cloud API send.
 */
export function isWhatsAppSimulationPayload(value: unknown): boolean {
  return booleanFlag(value, "isSimulation");
}

/**
 * Respondi-only flag on test POSTs. Meta never sends this; when true, delete any
 * existing conversation for the customer phone before processing this message.
 */
export function isWhatsAppStartCleanPayload(value: unknown): boolean {
  return booleanFlag(value, "startClean");
}

function booleanFlag(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>)[key] === true;
}
