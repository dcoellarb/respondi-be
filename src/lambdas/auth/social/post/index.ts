/**
 * @openapi
 * /auth/social:
 *   post:
 *     operationId: socialSignIn
 *     summary: Sign in with a Google ID token
 *     description: Verifies the Google token, finds or creates the Cognito user, and returns Cognito tokens. An email that already belongs to a password account is rejected and is not linked.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, idToken]
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [google]
 *               idToken:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *     responses:
 *       "200":
 *         description: Signed in
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/SocialAuthSession"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "409":
 *         $ref: "#/components/responses/Conflict"
 */
import { randomBytes } from "crypto";
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  attributeValue,
  authUserFromAttributes,
  AuthUser,
  tokenResult,
} from "../../../utils/auth/cognitoProfile";
import { getErrorName } from "../../../utils/auth/errors";
import { buildSocialAuthProof } from "../../../utils/auth/socialAuthProof";
import {
  SocialTokenError,
  verifyGoogleIdToken,
  VerifiedGoogleIdentity,
} from "../../../utils/auth/socialIdToken";
import { isNonEmptyString, readJsonObject } from "../../../utils/http/body";
import {
  createErrorResponse,
  createSuccessResponse,
} from "../../../utils/http/response";

const cognitoClient = new CognitoIdentityProviderClient({});
const NAME_MAX_LENGTH = 100;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function randomPassword(): string {
  return `Aa1!${randomBytes(24).toString("base64url")}`;
}

function sanitizeName(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("INVALID_NAME");
  }
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, NAME_MAX_LENGTH);
}

async function findUser(email: string) {
  try {
    return await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: requireEnv("USER_POOL_ID"),
        Username: email,
      }),
    );
  } catch (error) {
    if (getErrorName(error) === "UserNotFoundException") return null;
    throw error;
  }
}

async function rollbackCognitoUser(username: string): Promise<void> {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) return;
  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      }),
    );
  } catch (rollbackError) {
    console.error("Failed to roll back Cognito user after Google signup", {
      username,
      rollbackError,
    });
  }
}

async function completeCustomAuth(
  cognitoUsername: string,
  identity: VerifiedGoogleIdentity,
) {
  const clientId = requireEnv("CLIENT_ID");
  const secret = requireEnv("SOCIAL_AUTH_SECRET");
  const metadata = {
    provider: identity.provider,
    providerSubject: identity.subject,
  };

  const started = await cognitoClient.send(
    new InitiateAuthCommand({
      AuthFlow: "CUSTOM_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: cognitoUsername },
      ClientMetadata: metadata,
    }),
  );

  const nonce = started.ChallengeParameters?.nonce;
  if (!started.Session || !nonce) {
    throw new Error("Cognito did not return a Google auth challenge");
  }

  const expiry = Math.floor(Date.now() / 1000) + 60;
  const answer = buildSocialAuthProof({
    secret,
    provider: identity.provider,
    providerSubject: identity.subject,
    cognitoUsername,
    expiry,
    nonce,
    clientId,
  });

  const completed = await cognitoClient.send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: "CUSTOM_CHALLENGE",
      Session: started.Session,
      ChallengeResponses: {
        USERNAME: cognitoUsername,
        ANSWER: answer,
      },
      ClientMetadata: metadata,
    }),
  );

  return tokenResult(completed);
}

function emailAlreadyExists(): APIGatewayProxyResult {
  return createErrorResponse(
    "An account already exists with this email. Sign in with your password.",
    409,
    { code: "USER_ALREADY_EXISTS" },
  );
}

function profileFromUser(
  attributes: { Name?: string; Value?: string }[] | undefined,
): AuthUser {
  return authUserFromAttributes(attributes, attributeValue(attributes, "sub"));
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  let createdUsername: string | undefined;

  try {
    const body = readJsonObject(event);
    if (!body.ok) return body.response;

    const raw = body.value;
    if (raw.provider !== "google") {
      return createErrorResponse("provider must be google", 400, {
        code: "INVALID_PROVIDER",
      });
    }
    if (!isNonEmptyString(raw.idToken)) {
      return createErrorResponse("idToken is required", 400, {
        code: "MISSING_REQUIRED_FIELDS",
        missingFields: ["idToken"],
      });
    }

    let firstName: string | undefined;
    let lastName: string | undefined;
    try {
      firstName = sanitizeName(raw.firstName);
      lastName = sanitizeName(raw.lastName);
    } catch {
      return createErrorResponse("firstName and lastName must be strings", 400, {
        code: "INVALID_NAME",
      });
    }

    let identity: VerifiedGoogleIdentity;
    try {
      identity = await verifyGoogleIdToken(raw.idToken.trim());
    } catch (error) {
      if (error instanceof SocialTokenError && error.message.includes("not configured")) {
        return createErrorResponse("Google sign-in is not configured", 500, {
          code: "SOCIAL_AUTH_NOT_CONFIGURED",
        });
      }
      return createErrorResponse("Invalid identity token", 400, {
        code: "INVALID_ID_TOKEN",
      });
    }

    if (!identity.email || !identity.emailVerified) {
      return createErrorResponse("A verified email is required to create an account", 400, {
        code: "EMAIL_REQUIRED",
      });
    }

    const email = identity.email;
    const givenName = firstName ?? identity.givenName;
    const familyName = lastName ?? identity.familyName;
    let accountCreated = false;
    let existing = await findUser(email);

    if (existing) {
      const provider = attributeValue(existing.UserAttributes, "custom:authProvider");
      const subject = attributeValue(existing.UserAttributes, "custom:providerSubject");
      if (provider !== "google" || subject !== identity.subject) {
        return emailAlreadyExists();
      }
    } else {
      const userPoolId = requireEnv("USER_POOL_ID");
      const attributes = [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "custom:authProvider", Value: "google" },
        { Name: "custom:providerSubject", Value: identity.subject },
      ];
      if (givenName) attributes.push({ Name: "given_name", Value: givenName });
      if (familyName) attributes.push({ Name: "family_name", Value: familyName });

      try {
        await cognitoClient.send(
          new AdminCreateUserCommand({
            UserPoolId: userPoolId,
            Username: email,
            MessageAction: "SUPPRESS",
            UserAttributes: attributes,
          }),
        );
        createdUsername = email;
        await cognitoClient.send(
          new AdminSetUserPasswordCommand({
            UserPoolId: userPoolId,
            Username: email,
            Password: randomPassword(),
            Permanent: true,
          }),
        );
        accountCreated = true;
      } catch (error) {
        if (getErrorName(error) !== "UsernameExistsException") throw error;
        existing = await findUser(email);
        if (!existing) throw error;
        const provider = attributeValue(existing.UserAttributes, "custom:authProvider");
        const subject = attributeValue(existing.UserAttributes, "custom:providerSubject");
        if (provider !== "google" || subject !== identity.subject) {
          return emailAlreadyExists();
        }
      }
    }

    const current = existing ?? (await findUser(email));
    if (!current?.Username) {
      throw new Error("Cognito user has no username");
    }

    const authResponse = await completeCustomAuth(current.Username, identity);
    createdUsername = undefined;
    const refreshed = await findUser(email);

    return createSuccessResponse({
      message: "User signed in successfully",
      authResponse,
      user: profileFromUser(refreshed?.UserAttributes ?? current.UserAttributes),
      accountCreated,
    });
  } catch (error) {
    if (createdUsername) await rollbackCognitoUser(createdUsername);
    console.error(error);
    return createErrorResponse("Failed to sign in user", 500, {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
