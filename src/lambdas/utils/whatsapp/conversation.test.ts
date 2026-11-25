import {
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CONVERSATION_TTL_MS, MAX_CONVERSATION_MESSAGES } from "../account/keys";
import {
  appendConversationMessages,
  clearConversations,
  formatConversationForPrompt,
  getConversation,
} from "./conversation";

const send = jest.fn();

jest.mock("../dynamo/client", () => ({
  getDocumentClient: () => ({ send }),
  requireTableName: () => "RespondiBe-test",
}));

describe("whatsapp conversation", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("formats history for prompts", () => {
    expect(
      formatConversationForPrompt([
        { direction: "inbound", text: "Hola", at: "t1" },
        { direction: "outbound", text: "¡Hola!", at: "t2" },
        {
          direction: "system",
          text: "Cannot answer from account data: no parking info",
          at: "t3",
        },
      ]),
    ).toBe(
      "Customer: Hola\nBusiness: ¡Hola!\nSystem: Cannot answer from account data: no parking info",
    );
  });

  it("loads the newest conversation by PK", async () => {
    send.mockResolvedValueOnce({
      Items: [
        {
          PK: "CONVERSATION#acc#+15551212",
          SK: "2026-11-23T20:00:00.000Z",
          accountId: "acc",
          customerPhoneE164: "+15551212",
          createdAt: "2026-11-23T20:00:00.000Z",
          updatedAt: "2026-11-23T20:05:00.000Z",
          messages: [{ direction: "inbound", text: "hi", at: "t" }],
          expiresAt: 1,
        },
      ],
    });

    const conversation = await getConversation("acc", "+15551212");
    expect(conversation?.sk).toBe("2026-11-23T20:00:00.000Z");
    expect(send).toHaveBeenCalledWith(expect.any(QueryCommand));
  });

  it("creates a conversation with creation-time SK, TTL, and trims to last 6", async () => {
    send.mockResolvedValue({});
    const now = new Date("2026-11-23T21:00:00.000Z");
    const seed = Array.from({ length: 5 }, (_, i) => ({
      direction: "inbound" as const,
      text: `old-${i}`,
    }));

    const created = await appendConversationMessages({
      accountId: "acc",
      customerPhoneE164: "+15551212",
      existing: null,
      messages: [...seed, { direction: "outbound", text: "reply" }],
      now,
    });

    expect(created.sk).toBe("2026-11-23T21:00:00.000Z");
    expect(created.messages).toHaveLength(MAX_CONVERSATION_MESSAGES);
    expect(created.messages[0].text).toBe("old-0");
    expect(created.messages.at(-1)?.text).toBe("reply");
    expect(send).toHaveBeenCalledWith(expect.any(PutCommand));
    const putInput = (send.mock.calls[0][0] as { input: { Item: { expiresAt: number } } })
      .input;
    expect(putInput.Item.expiresAt).toBe(
      Math.floor((now.getTime() + CONVERSATION_TTL_MS) / 1000),
    );
  });

  it("updates messages in place without changing SK or TTL", async () => {
    send.mockResolvedValue({});
    const existing = {
      accountId: "acc",
      customerPhoneE164: "+15551212",
      createdAt: "2026-11-23T20:00:00.000Z",
      updatedAt: "2026-11-23T20:00:00.000Z",
      messages: [{ direction: "inbound" as const, text: "hi", at: "t0" }],
      pk: "CONVERSATION#acc#+15551212",
      sk: "2026-11-23T20:00:00.000Z",
    };

    const updated = await appendConversationMessages({
      accountId: "acc",
      customerPhoneE164: "+15551212",
      existing,
      messages: [{ direction: "outbound", text: "hola" }],
      now: new Date("2026-11-23T20:01:00.000Z"),
    });

    expect(updated.sk).toBe(existing.sk);
    expect(updated.messages).toHaveLength(2);
    expect(send).toHaveBeenCalledWith(expect.any(UpdateCommand));
  });

  it("clears every conversation row for the account + customer phone", async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            PK: "CONVERSATION#acc#+15551212",
            SK: "2026-11-23T19:00:00.000Z",
          },
          {
            PK: "CONVERSATION#acc#+15551212",
            SK: "2026-11-23T20:00:00.000Z",
          },
        ],
      })
      .mockResolvedValue({});

    const deleted = await clearConversations("acc", "+15551212");
    expect(deleted).toBe(2);
    expect(send).toHaveBeenCalledWith(expect.any(QueryCommand));
    expect(send).toHaveBeenCalledWith(expect.any(DeleteCommand));
    expect(send).toHaveBeenCalledTimes(3);
  });
});
