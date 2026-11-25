import { APIGatewayProxyEvent } from "aws-lambda";
import { emailForUsername } from "../../utils/auth/cognitoEmail";
import { defaultStore } from "../../utils/account/store";
import { handler } from "./index";

jest.mock("../../utils/account/store", () => ({
  defaultStore: jest.fn(),
}));

jest.mock("../../utils/auth/cognitoEmail", () => ({
  emailForUsername: jest.fn(),
}));

const getProfile = jest.fn();
const saveProfile = jest.fn();

function event(body: unknown, pathParameters?: Record<string, string>): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: "PUT",
    isBase64Encoded: false,
    path: "/api/account",
    pathParameters: pathParameters ?? null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "/api/account",
    requestContext: {
      authorizer: {
        claims: { sub: "user-sub", username: "ada@example.com" },
      },
    } as unknown as APIGatewayProxyEvent["requestContext"],
  };
}

const profileBody = {
  businessName: "Ada Gym",
  phone: "+1 555 123 4567",
  contactName: "Ada Lovelace",
  scheduleMode: "per_address",
};

describe("PUT /account", () => {
  beforeEach(() => {
    getProfile.mockReset();
    saveProfile.mockReset();
    (defaultStore as jest.Mock).mockReturnValue({ getProfile, saveProfile });
    (emailForUsername as jest.Mock).mockReset();
  });

  it("stores the token subject and the Cognito email", async () => {
    getProfile.mockResolvedValue(null);
    (emailForUsername as jest.Mock).mockResolvedValue("ada@example.com");
    saveProfile.mockResolvedValue({
      created: true,
      profile: {
        accountId: "user-sub",
        email: "ada@example.com",
        businessName: "Ada Gym",
        phone: "+15551234567",
        contactName: "Ada Lovelace",
        contactPhone: null,
        scheduleMode: "per_address",
        hours: [],
        conversationsThisMonth: 0,
        conversationsMonth: "2026-01",
        conversationsMonthlyLimit: 100,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const response = await handler(event(profileBody));

    expect(response.statusCode).toBe(201);
    expect(emailForUsername).toHaveBeenCalledWith("ada@example.com");
    expect(saveProfile).toHaveBeenCalledWith(
      "user-sub",
      "ada@example.com",
      expect.objectContaining({ phone: "+15551234567", businessName: "Ada Gym" }),
    );
  });

  it("refuses an email or user id in the payload and path", async () => {
    const body = await handler(event({ ...profileBody, email: "other@example.com" }));
    const path = await handler(event(profileBody, { userId: "someone-else" }));

    expect(body.statusCode).toBe(400);
    expect(JSON.parse(body.body).code).toBe("IDENTITY_FIELD_NOT_ALLOWED");
    expect(path.statusCode).toBe(400);
    expect(saveProfile).not.toHaveBeenCalled();
  });
});
