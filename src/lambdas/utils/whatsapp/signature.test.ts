import { createHmac } from "crypto";
import { verifyWhatsAppSignature } from "./signature";

const secret = "meta-app-secret";
const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [],
});

describe("verifyWhatsAppSignature", () => {
  it("accepts a valid Meta signature", () => {
    const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyWhatsAppSignature(body, `sha256=${digest}`, secret)).toBe(true);
  });

  it("rejects a tampered body or header", () => {
    const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyWhatsAppSignature(`${body} `, `sha256=${digest}`, secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, `sha256=${"0".repeat(64)}`, secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, undefined, secret)).toBe(false);
  });
});
