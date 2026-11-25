import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export interface WhatsAppWebhookSecrets {
  verifyToken: string;
  appSecret: string;
  /**
   * Meta app id (same app as WhatsApp product). Required for Embedded Signup
   * code exchange. May be REPLACE_ME until configured.
   */
  appId: string;
  /**
   * Env-level Meta Cloud API token (legacy / single-number setups).
   * Per-account tokens from Embedded Signup take precedence when present.
   * May be REPLACE_ME until configured — send is skipped in that case.
   */
  accessToken: string;
}

let secretsClient: SecretsManagerClient | undefined;
let cached: WhatsAppWebhookSecrets | undefined;

export function resetWhatsAppWebhookSecretsCache(): void {
  cached = undefined;
  secretsClient = undefined;
}

function client(): SecretsManagerClient {
  if (!secretsClient) secretsClient = new SecretsManagerClient({});
  return secretsClient;
}

/**
 * Loads webhook + send credentials from Secrets Manager.
 * Secret name comes from WHATSAPP_WEBHOOK_SECRET_NAME (set by CDK).
 */
export async function getWhatsAppWebhookSecrets(): Promise<WhatsAppWebhookSecrets> {
  if (cached) return cached;

  const secretName = process.env.WHATSAPP_WEBHOOK_SECRET_NAME?.trim();
  if (!secretName) {
    throw new Error("WHATSAPP_WEBHOOK_SECRET_NAME is not configured");
  }

  const result = await client().send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );
  if (!result.SecretString) {
    throw new Error("WhatsApp webhook secret is empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.SecretString);
  } catch {
    throw new Error("WhatsApp webhook secret must be JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WhatsApp webhook secret must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const verifyToken =
    typeof record.verifyToken === "string" ? record.verifyToken.trim() : "";
  const appSecret =
    typeof record.appSecret === "string" ? record.appSecret.trim() : "";
  const appId = typeof record.appId === "string" ? record.appId.trim() : "";
  const accessToken =
    typeof record.accessToken === "string" ? record.accessToken.trim() : "";

  if (!verifyToken) {
    throw new Error("WhatsApp verifyToken is not configured in Secrets Manager");
  }
  if (!appSecret) {
    throw new Error("WhatsApp appSecret is not configured in Secrets Manager");
  }

  cached = {
    verifyToken,
    appSecret,
    appId: appId || "REPLACE_ME",
    accessToken: accessToken || "REPLACE_ME",
  };
  return cached;
}

export function isWhatsAppAppIdConfigured(appId: string): boolean {
  const id = appId.trim();
  return Boolean(id) && id !== "REPLACE_ME";
}

export function isWhatsAppSendConfigured(accessToken: string): boolean {
  const token = accessToken.trim();
  return Boolean(token) && token !== "REPLACE_ME";
}
