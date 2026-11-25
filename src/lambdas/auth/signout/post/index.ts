/**
 * @openapi
 * /auth/signout:
 *   post:
 *     operationId: signOut
 *     summary: Sign out the current access token
 *     description: Requires Authorization Bearer access token. Invalidates that user's Cognito sessions.
 *     tags: [Auth]
 *     responses:
 *       "200":
 *         description: Signed out
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Message"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 */
import {
  CognitoIdentityProviderClient,
  GlobalSignOutCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  createErrorResponse,
  createSuccessResponse,
} from "../../../utils/http/response";

const cognitoClient = new CognitoIdentityProviderClient({});

function bearerToken(event: APIGatewayProxyEvent): string | undefined {
  const header = event.headers?.Authorization || event.headers?.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const accessToken = bearerToken(event);
  if (!accessToken) {
    return createErrorResponse("Access token is required", 401, {
      code: "UNAUTHORIZED",
    });
  }

  try {
    await cognitoClient.send(
      new GlobalSignOutCommand({ AccessToken: accessToken }),
    );
    return createSuccessResponse({ message: "User signed out successfully" });
  } catch (error) {
    console.error(error);
    return createErrorResponse("Failed to sign out user", 500, {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
