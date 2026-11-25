import { APIGatewayProxyEvent } from "aws-lambda";
import { rejectIdentityFields, requireAccount } from "./requireAccount";

function event(
  claims?: Record<string, string>,
  extra?: Partial<APIGatewayProxyEvent>,
): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/api/account",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "/api/account",
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    } as APIGatewayProxyEvent["requestContext"],
    ...extra,
  };
}

describe("requireAccount", () => {
  it("reads the account id and username from the access token", () => {
    const result = requireAccount(
      event({ sub: "user-sub", username: "ada@example.com" }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.caller).toEqual({
        accountId: "user-sub",
        username: "ada@example.com",
      });
    }
  });

  it("rejects a missing token", () => {
    const result = requireAccount(event());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.statusCode).toBe(401);
  });

  it("rejects a user id supplied in the path or query", () => {
    const path = requireAccount(
      event({ sub: "user-sub", username: "ada@example.com" }, {
        pathParameters: { userId: "someone-else" },
      }),
    );
    const query = requireAccount(
      event({ sub: "user-sub", username: "ada@example.com" }, {
        queryStringParameters: { email: "other@example.com" },
      }),
    );

    expect(path.ok).toBe(false);
    expect(query.ok).toBe(false);
    if (!path.ok) {
      expect(path.response.statusCode).toBe(400);
      expect(JSON.parse(path.response.body).code).toBe("IDENTITY_FIELD_NOT_ALLOWED");
    }
  });
});

describe("rejectIdentityFields", () => {
  it("rejects email, accountId, and userId in a payload", () => {
    const response = rejectIdentityFields({
      businessName: "Ada Gym",
      email: "other@example.com",
      userId: "someone-else",
    });

    expect(response?.statusCode).toBe(400);
    expect(JSON.parse(response?.body ?? "{}").fields).toEqual(["userId", "email"]);
  });
});
