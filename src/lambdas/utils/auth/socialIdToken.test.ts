import { jwtVerify } from "jose";
import { SocialTokenError, verifyGoogleIdToken } from "./socialIdToken";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => "jwks"),
  jwtVerify: jest.fn(),
}));

const mockJwtVerify = jwtVerify as jest.Mock;

describe("verifyGoogleIdToken", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_IDS = "google-web-client";
  });

  it("returns the Google subject and verified email", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "google-sub",
        email: "Ada@Example.com",
        email_verified: true,
        given_name: "Ada",
        family_name: "Lovelace",
      },
    });

    await expect(verifyGoogleIdToken("header.payload.sig")).resolves.toEqual({
      provider: "google",
      subject: "google-sub",
      email: "ada@example.com",
      emailVerified: true,
      givenName: "Ada",
      familyName: "Lovelace",
    });
  });

  it("rejects a token when Google client ids are not configured", async () => {
    delete process.env.GOOGLE_CLIENT_IDS;

    await expect(verifyGoogleIdToken("header.payload.sig")).rejects.toBeInstanceOf(
      SocialTokenError,
    );
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it("rejects a token jose will not verify", async () => {
    mockJwtVerify.mockRejectedValue(new Error("bad signature"));

    await expect(verifyGoogleIdToken("header.payload.sig")).rejects.toBeInstanceOf(
      SocialTokenError,
    );
  });
});
