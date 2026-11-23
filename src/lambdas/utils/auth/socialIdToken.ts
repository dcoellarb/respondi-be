import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export interface VerifiedGoogleIdentity {
  provider: "google";
  subject: string;
  email?: string;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
}

export class SocialTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialTokenError";
  }
}

function audiences(name: string): string[] {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function stringClaim(payload: JWTPayload, name: string): string | undefined {
  const value = payload[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function emailVerifiedFromPayload(payload: JWTPayload): boolean {
  return payload.email_verified === true || payload.email_verified === "true";
}

export async function verifyGoogleIdToken(
  idToken: string,
): Promise<VerifiedGoogleIdentity> {
  const allowed = audiences("GOOGLE_CLIENT_IDS");
  if (allowed.length === 0) {
    throw new SocialTokenError("GOOGLE_CLIENT_IDS is not configured");
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: allowed,
      algorithms: ["RS256"],
    }));
  } catch (error) {
    console.error("Google ID token verification failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    throw new SocialTokenError("Invalid Google identity token");
  }

  if (!payload.sub) {
    throw new SocialTokenError("Invalid Google identity token");
  }

  return {
    provider: "google",
    subject: payload.sub,
    email: stringClaim(payload, "email")?.toLowerCase(),
    emailVerified: emailVerifiedFromPayload(payload),
    givenName: stringClaim(payload, "given_name"),
    familyName: stringClaim(payload, "family_name"),
  };
}
