import {
  buildSocialAuthProof,
  SOCIAL_AUTH_TTL_SECONDS,
  verifySocialAuthProof,
} from "./socialAuthProof";

const proofInput = {
  secret: "test-secret",
  provider: "google",
  providerSubject: "google-sub",
  cognitoUsername: "ada@example.com",
  expiry: 1_700_000_060,
  nonce: "nonce-1",
  clientId: "client-1",
};

describe("socialAuthProof", () => {
  it("accepts a proof bound to the session nonce", () => {
    const answer = buildSocialAuthProof(proofInput);

    expect(
      verifySocialAuthProof({
        ...proofInput,
        answer,
        nowSeconds: proofInput.expiry - 10,
      }),
    ).toBe(true);
  });

  it("rejects a proof presented to a different nonce", () => {
    const answer = buildSocialAuthProof(proofInput);

    expect(
      verifySocialAuthProof({
        ...proofInput,
        answer,
        nonce: "other-nonce",
        nowSeconds: proofInput.expiry - 10,
      }),
    ).toBe(false);
  });

  it("rejects an expired proof", () => {
    const answer = buildSocialAuthProof(proofInput);

    expect(
      verifySocialAuthProof({
        ...proofInput,
        answer,
        nowSeconds: proofInput.expiry + 1,
      }),
    ).toBe(false);
  });

  it("rejects a proof whose expiry is beyond the allowed window", () => {
    const { expiry, ...identity } = proofInput;
    const answer = buildSocialAuthProof({
      ...proofInput,
      expiry: expiry + SOCIAL_AUTH_TTL_SECONDS + 31,
    });

    expect(
      verifySocialAuthProof({
        ...identity,
        answer,
        nowSeconds: expiry,
      }),
    ).toBe(false);
  });
});
