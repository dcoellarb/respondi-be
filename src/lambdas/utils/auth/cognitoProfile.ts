export type AuthProvider = "email" | "google";

export interface AuthUser {
  cognitoId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  authProvider: AuthProvider;
}

export interface CognitoAttribute {
  Name?: string;
  Value?: string;
}

export interface TokenResult {
  AccessToken: string;
  IdToken: string;
  RefreshToken?: string;
  ExpiresIn?: number;
  TokenType?: string;
}

export function attributeValue(
  attributes: CognitoAttribute[] | undefined,
  name: string,
): string | undefined {
  const value = attributes?.find((attribute) => attribute.Name === name)?.Value;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function authProviderFromAttribute(value: string | undefined): AuthProvider {
  return value === "google" ? "google" : "email";
}

export function authUserFromAttributes(
  attributes: CognitoAttribute[] | undefined,
  fallbackCognitoId?: string,
): AuthUser {
  const cognitoId = attributeValue(attributes, "sub") ?? fallbackCognitoId;
  const email = attributeValue(attributes, "email");
  if (!cognitoId || !email) {
    throw new Error("Cognito user is missing sub or email");
  }

  return {
    cognitoId,
    email,
    firstName: attributeValue(attributes, "given_name"),
    lastName: attributeValue(attributes, "family_name"),
    authProvider: authProviderFromAttribute(
      attributeValue(attributes, "custom:authProvider"),
    ),
  };
}

export function tokenResult(authResponse: {
  AuthenticationResult?: {
    AccessToken?: string;
    IdToken?: string;
    RefreshToken?: string;
    ExpiresIn?: number;
    TokenType?: string;
  };
}): TokenResult {
  const result = authResponse.AuthenticationResult;
  if (!result?.AccessToken || !result.IdToken) {
    throw new Error("Cognito did not return tokens");
  }
  return {
    AccessToken: result.AccessToken,
    IdToken: result.IdToken,
    RefreshToken: result.RefreshToken,
    ExpiresIn: result.ExpiresIn,
    TokenType: result.TokenType,
  };
}

export function cognitoIdFromIdToken(idToken: string): string {
  const payloadPart = idToken.split(".")[1];
  if (!payloadPart) {
    throw new Error("Failed to get user ID from authentication token");
  }
  const payload = JSON.parse(
    Buffer.from(payloadPart, "base64").toString(),
  ) as { sub?: string };
  if (!payload.sub) {
    throw new Error("Failed to get user ID from authentication token");
  }
  return payload.sub;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
