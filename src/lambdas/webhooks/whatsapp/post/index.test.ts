import { createHmac } from "crypto";
import { APIGatewayProxyEvent } from "aws-lambda";
import { defaultStore } from "../../../utils/account/store";
import { loadAnswerContext } from "../../../utils/whatsapp/answer-context";
import { classifyBusinessIntent } from "../../../utils/whatsapp/business-intent";
import {
  appendConversationMessages,
  clearConversations,
  getConversation,
} from "../../../utils/whatsapp/conversation";
import { generateWhatsAppReply } from "../../../utils/whatsapp/generate-reply";
import { sendWhatsAppTextMessage } from "../../../utils/whatsapp/outbound";
import {
  isWhatsAppReplyBlocked,
  putWhatsAppReplyBlock,
} from "../../../utils/whatsapp/reply-block";
import { getWhatsAppWebhookSecrets } from "../../../utils/whatsapp/secrets";
import { handler } from "./index";

jest.mock("../../../utils/whatsapp/secrets", () => ({
  getWhatsAppWebhookSecrets: jest.fn(),
  isWhatsAppSendConfigured: jest.requireActual("../../../utils/whatsapp/secrets")
    .isWhatsAppSendConfigured,
}));

jest.mock("../../../utils/whatsapp/connection-store", () => ({
  getWhatsAppConnection: jest.fn().mockResolvedValue(null),
}));

jest.mock("../../../utils/whatsapp/reply-block", () => ({
  isWhatsAppReplyBlocked: jest.fn().mockResolvedValue(false),
  putWhatsAppReplyBlock: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../utils/account/store", () => ({
  defaultStore: jest.fn(),
}));

jest.mock("../../../utils/whatsapp/business-intent", () => ({
  classifyBusinessIntent: jest.fn(),
}));

jest.mock("../../../utils/whatsapp/answer-context", () => ({
  loadAnswerContext: jest.fn(),
  summarizeAnswerContext: jest.fn(() => ({
    profile: true,
    products: null,
    addresses: 0,
    faqs: null,
  })),
}));

jest.mock("../../../utils/whatsapp/generate-reply", () => ({
  generateWhatsAppReply: jest.fn(),
}));

jest.mock("../../../utils/whatsapp/conversation", () => ({
  getConversation: jest.fn(),
  clearConversations: jest.fn(),
  appendConversationMessages: jest.fn(),
  formatConversationForPrompt: jest.fn(() => ""),
}));

jest.mock("../../../utils/whatsapp/outbound", () => ({
  buildWhatsAppTextMessage: jest.requireActual("../../../utils/whatsapp/outbound")
    .buildWhatsAppTextMessage,
  sendWhatsAppTextMessage: jest.fn(),
}));

const secret = "test-app-secret";
const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550783881",
              phone_number_id: "106540352242922",
            },
            messages: [
              {
                from: "16505551234",
                id: "wamid.TEST",
                timestamp: "1749416383",
                type: "text",
                text: { body: "What are your hours?" },
              },
            ],
          },
        },
      ],
    },
  ],
};

function event(
  body: string,
  signature?: string,
): APIGatewayProxyEvent {
  return {
    body,
    headers: signature ? { "X-Hub-Signature-256": signature } : {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/api/webhooks/whatsapp",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "/api/webhooks/whatsapp",
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
  };
}

describe("POST /webhooks/whatsapp", () => {
  const findAccountIdByPhone = jest.fn();
  const consumeConversationQuota = jest.fn();
  const store = { findAccountIdByPhone, consumeConversationQuota };

  beforeEach(() => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "verify-me",
      appSecret: secret,
      accessToken: "REPLACE_ME",
    });
    (sendWhatsAppTextMessage as jest.Mock).mockReset();
    (sendWhatsAppTextMessage as jest.Mock).mockResolvedValue({
      messageId: "wamid.OUT",
    });
    findAccountIdByPhone.mockReset();
    findAccountIdByPhone.mockResolvedValue("account-1");
    consumeConversationQuota.mockReset();
    consumeConversationQuota.mockResolvedValue({
      allowed: true,
      count: 1,
      month: "2026-11",
      limit: 100,
    });
    (defaultStore as jest.Mock).mockReturnValue(store);
    (classifyBusinessIntent as jest.Mock).mockReset();
    (classifyBusinessIntent as jest.Mock).mockResolvedValue({
      businessRelated: true,
      sources: ["addresses"],
      reason: "asks about hours",
    });
    (loadAnswerContext as jest.Mock).mockReset();
    (loadAnswerContext as jest.Mock).mockResolvedValue({
      accountId: "account-1",
      addresses: [],
      profile: null,
    });
    (generateWhatsAppReply as jest.Mock).mockReset();
    (generateWhatsAppReply as jest.Mock).mockResolvedValue({
      answered: true,
      text: "We are open Monday 9–17.",
    });
    (getConversation as jest.Mock).mockReset();
    (getConversation as jest.Mock).mockResolvedValue(null);
    (clearConversations as jest.Mock).mockReset();
    (clearConversations as jest.Mock).mockResolvedValue(0);
    (appendConversationMessages as jest.Mock).mockReset();
    (appendConversationMessages as jest.Mock).mockResolvedValue({
      messages: [],
    });
    (isWhatsAppReplyBlocked as jest.Mock).mockReset();
    (isWhatsAppReplyBlocked as jest.Mock).mockResolvedValue(false);
    (putWhatsAppReplyBlock as jest.Mock).mockReset();
    (putWhatsAppReplyBlock as jest.Mock).mockResolvedValue(undefined);
  });

  it("returns a WhatsApp Cloud API text payload", async () => {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    const response = await handler(event(body, signature));

    expect(findAccountIdByPhone).toHaveBeenCalledWith("+15550783881");
    expect(classifyBusinessIntent).toHaveBeenCalledWith("What are your hours?", "");
    expect(loadAnswerContext).toHaveBeenCalledWith(store, "account-1", ["addresses"]);
    expect(generateWhatsAppReply).toHaveBeenCalledWith(
      expect.objectContaining({
        customerMessage: "What are your hours?",
        sources: ["addresses"],
      }),
    );
    expect(appendConversationMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-1",
        customerPhoneE164: "+16505551234",
        messages: [
          { direction: "inbound", text: "What are your hours?" },
          { direction: "outbound", text: "We are open Monday 9–17." },
        ],
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      whatsappMessage: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "16505551234",
        type: "text",
        text: { preview_url: false, body: "We are open Monday 9–17." },
      },
    });
    expect(isWhatsAppReplyBlocked).toHaveBeenCalledWith(
      "+15550783881",
      "+16505551234",
    );
    expect(putWhatsAppReplyBlock).toHaveBeenCalledWith(
      "+16505551234",
      "+15550783881",
    );
  });

  it("skips auto-reply when BLOCK#{business}#{customer} exists", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "meta-token",
    });
    (isWhatsAppReplyBlocked as jest.Mock).mockResolvedValue(true);

    const response = await handler(event(JSON.stringify(payload)));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      skipped: true,
      reason: "reply_blocked",
    });
    expect(classifyBusinessIntent).not.toHaveBeenCalled();
    expect(generateWhatsAppReply).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(putWhatsAppReplyBlock).not.toHaveBeenCalled();
  });

  it("rejects a missing signature", async () => {
    const response = await handler(event(JSON.stringify(payload)));
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error).toMatch(/signature/i);
  });

  it("skips signature checks when appSecret is REPLACE_ME", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "REPLACE_ME",
    });
    const response = await handler(event(JSON.stringify(payload)));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).whatsappMessage.to).toBe("16505551234");
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
  });

  it("sends via Cloud API when accessToken is configured", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "meta-token",
    });
    const response = await handler(event(JSON.stringify(payload)));
    expect(response.statusCode).toBe(200);
    expect(sendWhatsAppTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: "106540352242922",
        accessToken: "meta-token",
        message: expect.objectContaining({
          to: "16505551234",
          text: { preview_url: false, body: "We are open Monday 9–17." },
        }),
      }),
    );
  });

  it("skips Cloud API send when isSimulation is true", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "meta-token",
    });
    const response = await handler(
      event(JSON.stringify({ ...payload, isSimulation: true })),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).whatsappMessage.text.body).toBe(
      "We are open Monday 9–17.",
    );
    expect(sendWhatsAppTextMessage).not.toHaveBeenCalled();
    expect(consumeConversationQuota).not.toHaveBeenCalled();
  });

  it("clears prior conversation when startClean is true", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "REPLACE_ME",
    });
    (getConversation as jest.Mock).mockResolvedValue({
      messages: [{ direction: "inbound", text: "old", at: "t0" }],
    });
    (clearConversations as jest.Mock).mockResolvedValue(1);

    const response = await handler(
      event(
        JSON.stringify({
          ...payload,
          isSimulation: true,
          startClean: true,
        }),
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(clearConversations).toHaveBeenCalledWith("account-1", "+16505551234");
    expect(getConversation).not.toHaveBeenCalled();
    expect(classifyBusinessIntent).toHaveBeenCalledWith("What are your hours?", "");
    expect(appendConversationMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        existing: null,
      }),
    );
  });

  it("returns 429 when the monthly conversation quota is exhausted", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "REPLACE_ME",
    });
    consumeConversationQuota.mockResolvedValue({
      allowed: false,
      count: 100,
      month: "2026-11",
      limit: 100,
    });
    const response = await handler(event(JSON.stringify(payload)));
    expect(response.statusCode).toBe(429);
    expect(JSON.parse(response.body).error).toMatch(/monthly conversation limit/i);
    expect(generateWhatsAppReply).not.toHaveBeenCalled();
  });

  it("rejects when the business phone is missing", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "REPLACE_ME",
    });
    const response = await handler(
      event(
        JSON.stringify({
          object: "whatsapp_business_account",
          entry: [{ changes: [{ value: { messages: [] } }] }],
        }),
      ),
    );
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/phone/i);
    expect(findAccountIdByPhone).not.toHaveBeenCalled();
  });

  it("rejects when no account owns the business phone", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "REPLACE_ME",
    });
    findAccountIdByPhone.mockResolvedValue(null);
    const response = await handler(event(JSON.stringify(payload)));
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error).toMatch(/no account/i);
  });

  it("rejects when the message is not business-related", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "REPLACE_ME",
    });
    (classifyBusinessIntent as jest.Mock).mockResolvedValue({
      businessRelated: false,
      sources: [],
      reason: "casual greeting",
    });
    const response = await handler(event(JSON.stringify(payload)));
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error).toMatch(/not business-related/i);
    expect(generateWhatsAppReply).not.toHaveBeenCalled();
    expect(appendConversationMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { direction: "inbound", text: "What are your hours?" },
          {
            direction: "system",
            text: "Message is not business-related: casual greeting",
          },
        ],
      }),
    );
  });

  it("returns 422 with no WhatsApp message when context cannot answer", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "REPLACE_ME",
      appSecret: "REPLACE_ME",
      accessToken: "REPLACE_ME",
    });
    (generateWhatsAppReply as jest.Mock).mockResolvedValue({
      answered: false,
      reason: "no payment or parking info in context",
    });
    const response = await handler(event(JSON.stringify(payload)));
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error).toMatch(/cannot answer from account data/i);
    expect(JSON.parse(response.body).whatsappMessage).toBeUndefined();
    expect(appendConversationMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { direction: "inbound", text: "What are your hours?" },
          {
            direction: "system",
            text: "Cannot answer from account data: no payment or parking info in context",
          },
        ],
      }),
    );
  });

  it("rejects a non-WhatsApp object", async () => {
    const body = JSON.stringify({ object: "page", entry: [] });
    const signature = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    const response = await handler(event(body, signature));
    expect(response.statusCode).toBe(400);
  });
});
