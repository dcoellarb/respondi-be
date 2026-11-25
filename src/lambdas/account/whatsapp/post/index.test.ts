import { APIGatewayProxyEvent } from "aws-lambda";
import { defaultStore } from "../../../utils/account/store";
import { saveWhatsAppConnection } from "../../../utils/whatsapp/connection-store";
import {
  exchangeEmbeddedSignupCode,
  fetchWhatsAppDisplayPhone,
  registerWhatsAppPhoneNumber,
  subscribeWhatsAppApp,
} from "../../../utils/whatsapp/embedded-signup";
import { getWhatsAppWebhookSecrets } from "../../../utils/whatsapp/secrets";
import { handler } from "./index";

jest.mock("../../../utils/account/store", () => ({
  defaultStore: jest.fn(),
}));

jest.mock("../../../utils/whatsapp/secrets", () => ({
  getWhatsAppWebhookSecrets: jest.fn(),
  isWhatsAppAppIdConfigured: jest.requireActual("../../../utils/whatsapp/secrets")
    .isWhatsAppAppIdConfigured,
}));

jest.mock("../../../utils/whatsapp/embedded-signup", () => ({
  exchangeEmbeddedSignupCode: jest.fn(),
  subscribeWhatsAppApp: jest.fn(),
  registerWhatsAppPhoneNumber: jest.fn(),
  fetchWhatsAppDisplayPhone: jest.fn(),
  WhatsAppGraphError: class WhatsAppGraphError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message);
      this.name = "WhatsAppGraphError";
    }
  },
}));

jest.mock("../../../utils/whatsapp/connection-store", () => ({
  saveWhatsAppConnection: jest.fn(),
}));

function event(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/api/account/whatsapp/connect",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "",
    requestContext: {
      accountId: "",
      apiId: "",
      authorizer: {
        claims: {
          sub: "account-1",
          username: "account-1",
        },
      },
      protocol: "",
      httpMethod: "POST",
      identity: {} as never,
      path: "",
      stage: "",
      requestId: "",
      requestTimeEpoch: 0,
      resourceId: "",
      resourcePath: "",
    },
  } as unknown as APIGatewayProxyEvent;
}

describe("POST /account/whatsapp/connect", () => {
  const getProfile = jest.fn();
  const findAccountIdByPhone = jest.fn();
  const saveProfile = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (defaultStore as jest.Mock).mockReturnValue({
      getProfile,
      findAccountIdByPhone,
      saveProfile,
    });
    getProfile.mockResolvedValue({
      accountId: "account-1",
      email: "owner@example.com",
      businessName: "CircuitFit",
      phone: "+15551110000",
      contactName: "Owner",
      contactPhone: null,
      scheduleMode: "business",
      hours: [],
      conversationsThisMonth: 0,
      conversationsMonth: "2026-11",
      conversationsMonthlyLimit: 100,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    findAccountIdByPhone.mockResolvedValue(null);
    saveProfile.mockResolvedValue({ profile: {}, created: false });
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "verify",
      appSecret: "secret",
      appId: "1177795441854369",
      accessToken: "REPLACE_ME",
    });
    (exchangeEmbeddedSignupCode as jest.Mock).mockResolvedValue("business-token");
    (subscribeWhatsAppApp as jest.Mock).mockResolvedValue(undefined);
    (registerWhatsAppPhoneNumber as jest.Mock).mockResolvedValue(undefined);
    (fetchWhatsAppDisplayPhone as jest.Mock).mockResolvedValue("+15551866905");
    (saveWhatsAppConnection as jest.Mock).mockResolvedValue({
      connected: true,
      wabaId: "waba-1",
      phoneNumberId: "phone-1",
      phoneE164: "+15551866905",
      connectedAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    });
  });

  it("exchanges the code, registers, stores connection, and syncs profile phone", async () => {
    const response = await handler(
      event({
        code: "exchange-code",
        wabaId: "waba-1",
        phoneNumberId: "phone-1",
        pin: "123456",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(exchangeEmbeddedSignupCode).toHaveBeenCalledWith({
      appId: "1177795441854369",
      appSecret: "secret",
      code: "exchange-code",
    });
    expect(subscribeWhatsAppApp).toHaveBeenCalledWith({
      wabaId: "waba-1",
      accessToken: "business-token",
    });
    expect(registerWhatsAppPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: "phone-1",
      accessToken: "business-token",
      pin: "123456",
    });
    expect(saveProfile).toHaveBeenCalledWith(
      "account-1",
      "owner@example.com",
      expect.objectContaining({
        phone: "+15551866905",
      }),
    );
    expect(saveWhatsAppConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-1",
        accessToken: "business-token",
        phoneE164: "+15551866905",
      }),
    );
  });

  it("skips register when skipRegister is true", async () => {
    const response = await handler(
      event({
        code: "exchange-code",
        wabaId: "waba-1",
        phoneNumberId: "phone-1",
        skipRegister: true,
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(registerWhatsAppPhoneNumber).not.toHaveBeenCalled();
  });

  it("requires pin when not skipping register", async () => {
    const response = await handler(
      event({
        code: "exchange-code",
        wabaId: "waba-1",
        phoneNumberId: "phone-1",
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(exchangeEmbeddedSignupCode).not.toHaveBeenCalled();
  });
});
