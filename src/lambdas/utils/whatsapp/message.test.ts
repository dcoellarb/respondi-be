import { extractWhatsAppInboundText, extractWhatsAppTextMessage } from "./message";

describe("extractWhatsAppInboundText", () => {
  it("returns text, from, and phoneNumberId for the first text message", () => {
    expect(
      extractWhatsAppInboundText({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "106540352242922" },
                  messages: [
                    {
                      from: "16505551234",
                      type: "text",
                      text: { body: "  Do you have memberships?  " },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      text: "Do you have memberships?",
      from: "16505551234",
      phoneNumberId: "106540352242922",
    });
    expect(
      extractWhatsAppTextMessage({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "106540352242922" },
                  messages: [
                    {
                      from: "16505551234",
                      type: "text",
                      text: { body: "Hi" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toBe("Hi");
  });

  it("returns null when phone_number_id is missing", () => {
    expect(
      extractWhatsAppInboundText({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "16505551234",
                      type: "text",
                      text: { body: "Hi" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toBeNull();
  });

  it("returns null for status-only payloads", () => {
    expect(
      extractWhatsAppInboundText({
        entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1" }] } }] }],
      }),
    ).toBeNull();
  });
});
