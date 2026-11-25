import {
  extractWhatsAppBusinessPhone,
  normalizeWhatsAppBusinessPhone,
} from "./phone";

describe("whatsapp phone", () => {
  it("normalizes Meta digit strings and E.164 values", () => {
    expect(normalizeWhatsAppBusinessPhone("15550783881")).toBe("+15550783881");
    expect(normalizeWhatsAppBusinessPhone("+1 (555) 078-3881")).toBe("+15550783881");
    expect(normalizeWhatsAppBusinessPhone("")).toBeNull();
  });

  it("extracts display_phone_number from a webhook payload", () => {
    const phone = extractWhatsAppBusinessPhone({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: {
                  display_phone_number: "15550783881",
                  phone_number_id: "106540352242922",
                },
              },
            },
          ],
        },
      ],
    });
    expect(phone).toBe("+15550783881");
  });

  it("returns null when metadata is missing", () => {
    expect(
      extractWhatsAppBusinessPhone({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ value: {} }] }],
      }),
    ).toBeNull();
  });
});
