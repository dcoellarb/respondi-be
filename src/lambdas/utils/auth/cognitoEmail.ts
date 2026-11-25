import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { AccountError } from "../account/errors";
import { attributeValue, normalizeEmail } from "./cognitoProfile";
import { getErrorName } from "./errors";

let cognitoClient: CognitoIdentityProviderClient | undefined;

function cognito(): CognitoIdentityProviderClient {
  if (!cognitoClient) cognitoClient = new CognitoIdentityProviderClient({});
  return cognitoClient;
}

export async function emailForUsername(username: string): Promise<string> {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) throw new Error("USER_POOL_ID is not configured");

  try {
    const result = await cognito().send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      }),
    );
    const email = attributeValue(result.UserAttributes, "email");
    if (!email) {
      throw new AccountError("Account email is not available", 500, "EMAIL_NOT_AVAILABLE");
    }
    return normalizeEmail(email);
  } catch (error) {
    if (error instanceof AccountError) throw error;
    if (getErrorName(error) === "UserNotFoundException") {
      throw new AccountError(
        "Unauthorized - no valid authentication found",
        401,
        "UNAUTHORIZED",
      );
    }
    throw error;
  }
}
