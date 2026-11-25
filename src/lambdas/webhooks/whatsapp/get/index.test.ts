import { APIGatewayProxyEvent } from "aws-lambda";
import { getWhatsAppWebhookSecrets } from "../../../utils/whatsapp/secrets";
import { handler } from "./index";

jest.mock("../../../utils/whatsapp/secrets", () => ({
  getWhatsAppWebhookSecrets: jest.fn(),
}));

function event(
  query: Record<string, string>,
): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/api/webhooks/whatsapp",
    pathParameters: null,
    queryStringParameters: query,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "/api/webhooks/whatsapp",
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
  };
}

describe("GET /webhooks/whatsapp", () => {
  beforeEach(() => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockResolvedValue({
      verifyToken: "verify-me",
      appSecret: "app-secret",
    });
  });

  it("echoes hub.challenge as plain text", async () => {
    const response = await handler(
      event({
        "hub.mode": "subscribe",
        "hub.verify_token": "verify-me",
        "hub.challenge": "1158201444",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers?.["Content-Type"]).toBe("text/plain");
    expect(response.body).toBe("1158201444");
  });

  it("rejects a wrong verify token", async () => {
    const response = await handler(
      event({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong",
        "hub.challenge": "1158201444",
      }),
    );
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: "Invalid hub.verify_token",
    });
  });

  it("rejects when Secrets Manager is not configured yet", async () => {
    (getWhatsAppWebhookSecrets as jest.Mock).mockRejectedValue(
      new Error("WhatsApp verifyToken is not configured in Secrets Manager"),
    );
    const response = await handler(
      event({
        "hub.mode": "subscribe",
        "hub.verify_token": "verify-me",
        "hub.challenge": "1158201444",
      }),
    );
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error).toMatch(/not configured/i);
  });
});
