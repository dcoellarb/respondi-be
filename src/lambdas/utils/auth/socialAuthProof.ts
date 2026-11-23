import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const SOCIAL_AUTH_TTL_SECONDS = 60;

export function createSocialAuthNonce(): string {
  return randomBytes(16).toString("hex");
}

export function socialAuthProofMessage(input: {
  provider: string;
  providerSubject: string;
  cognitoUsername: string;
  expiry: number;
  nonce: string;
  clientId: string;
}): string {
  return [
    input.provider,
    input.providerSubject,
    input.cognitoUsername,
    String(input.expiry),
    input.nonce,
    input.clientId,
  ].join(":");
}

export function buildSocialAuthProof(input: {
  secret: string;
  provider: string;
  providerSubject: string;
  cognitoUsername: string;
  expiry: number;
  nonce: string;
  clientId: string;
}): string {
  const hmac = createHmac("sha256", input.secret)
    .update(socialAuthProofMessage(input))
    .digest("hex");
  return `${input.expiry}.${hmac}`;
}

export function verifySocialAuthProof(input: {
  secret: string;
  answer: string;
  provider: string;
  providerSubject: string;
  cognitoUsername: string;
  nonce: string;
  clientId: string;
  nowSeconds?: number;
}): boolean {
  const dot = input.answer.indexOf(".");
  if (dot <= 0) return false;

  const expiry = Number(input.answer.slice(0, dot));
  if (!Number.isInteger(expiry)) return false;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (expiry < now || expiry > now + SOCIAL_AUTH_TTL_SECONDS + 30) return false;

  const expected = buildSocialAuthProof({ ...input, expiry });
  const actual = Buffer.from(input.answer);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actual, expectedBuffer);
}
