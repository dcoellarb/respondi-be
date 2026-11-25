import { createHmac, timingSafeEqual } from "crypto";

/**
 * Meta signs webhook POST bodies with HMAC-SHA256 using the app secret.
 * Header form: X-Hub-Signature-256: sha256=<hex>
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started/#validating-payloads
 */
export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader.trim());
  if (!match) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = match[1].toLowerCase();
  if (expected.length !== provided.length) return false;

  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
}
