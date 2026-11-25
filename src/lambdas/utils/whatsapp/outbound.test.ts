import { buildWhatsAppTextMessage, sendWhatsAppTextMessage } from "./outbound";

describe("buildWhatsAppTextMessage", () => {
  it("builds a Cloud API text payload", () => {
    expect(buildWhatsAppTextMessage("16505551234", "  Hola  ")).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "16505551234",
      type: "text",
      text: { preview_url: false, body: "Hola" },
    });
  });

  it("rejects an empty body", () => {
    expect(() => buildWhatsAppTextMessage("16505551234", "   ")).toThrow(/empty/i);
  });
});

describe("sendWhatsAppTextMessage", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("posts to Graph API and returns the message id", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ messages: [{ id: "wamid.OUT.1" }] }),
    });

    const message = buildWhatsAppTextMessage("16505551234", "Hola");
    await expect(
      sendWhatsAppTextMessage({
        phoneNumberId: "106540352242922",
        accessToken: "token",
        message,
      }),
    ).resolves.toEqual({ messageId: "wamid.OUT.1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/106540352242922/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      }),
    );
  });

  it("throws with Meta error details on failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () =>
        JSON.stringify({ error: { message: "Invalid OAuth access token" } }),
    });

    await expect(
      sendWhatsAppTextMessage({
        phoneNumberId: "106540352242922",
        accessToken: "bad",
        message: buildWhatsAppTextMessage("16505551234", "Hola"),
      }),
    ).rejects.toThrow(/Invalid OAuth access token/);
  });
});
