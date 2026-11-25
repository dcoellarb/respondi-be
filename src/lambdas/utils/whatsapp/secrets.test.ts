import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  getWhatsAppWebhookSecrets,
  isWhatsAppSendConfigured,
  resetWhatsAppWebhookSecretsCache,
} from "./secrets";

jest.mock("@aws-sdk/client-secrets-manager", () => {
  const send = jest.fn();
  return {
    GetSecretValueCommand: jest.fn().mockImplementation((input) => input),
    SecretsManagerClient: jest.fn().mockImplementation(() => ({ send })),
  };
});

describe("getWhatsAppWebhookSecrets", () => {
  const previous = process.env.WHATSAPP_WEBHOOK_SECRET_NAME;

  beforeEach(() => {
    resetWhatsAppWebhookSecretsCache();
    process.env.WHATSAPP_WEBHOOK_SECRET_NAME = "RespondiBeStack-development-whatsapp-webhook";
    const send = new SecretsManagerClient({}).send as jest.Mock;
    send.mockReset();
    send.mockResolvedValue({
      SecretString: JSON.stringify({
        verifyToken: "verify-me",
        appSecret: "app-secret",
        accessToken: "meta-token",
        generatedNonce: "ignored",
      }),
    });
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.WHATSAPP_WEBHOOK_SECRET_NAME;
    else process.env.WHATSAPP_WEBHOOK_SECRET_NAME = previous;
  });

  it("loads and caches verifyToken, appSecret, and accessToken", async () => {
    const send = new SecretsManagerClient({}).send as jest.Mock;
    const first = await getWhatsAppWebhookSecrets();
    const second = await getWhatsAppWebhookSecrets();

    expect(first).toEqual({
      verifyToken: "verify-me",
      appSecret: "app-secret",
      appId: "REPLACE_ME",
      accessToken: "meta-token",
    });
    expect(second).toEqual(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(GetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: "RespondiBeStack-development-whatsapp-webhook",
    });
  });

  it("defaults missing accessToken to REPLACE_ME", async () => {
    const send = new SecretsManagerClient({}).send as jest.Mock;
    send.mockResolvedValue({
      SecretString: JSON.stringify({
        verifyToken: "REPLACE_ME",
        appSecret: "REPLACE_ME",
      }),
    });

    await expect(getWhatsAppWebhookSecrets()).resolves.toEqual({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      appId: "REPLACE_ME",
      accessToken: "REPLACE_ME",
    });
    expect(isWhatsAppSendConfigured("REPLACE_ME")).toBe(false);
    expect(isWhatsAppSendConfigured("real-token")).toBe(true);
  });
});
