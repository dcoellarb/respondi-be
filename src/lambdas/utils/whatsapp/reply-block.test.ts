import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { REPLY_BLOCK_TTL_MS } from "../account/keys";
import { isWhatsAppReplyBlocked, putWhatsAppReplyBlock } from "./reply-block";

const send = jest.fn();

jest.mock("../dynamo/client", () => ({
  getDocumentClient: () => ({ send }),
  requireTableName: () => "RespondiBe-test",
}));

describe("whatsapp reply-block", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("reads BLOCK#{quiet}#{other}", async () => {
    send.mockResolvedValueOnce({ Item: { PK: "BLOCK#+1#+2" } });
    await expect(isWhatsAppReplyBlocked("+15551111", "+15552222")).resolves.toBe(
      true,
    );
    expect(send).toHaveBeenCalledWith(
      expect.any(GetCommand),
    );
    const input = send.mock.calls[0][0].input;
    expect(input).toEqual({
      TableName: "RespondiBe-test",
      Key: { PK: "BLOCK#+15551111#+15552222", SK: "ACTIVE" },
    });
  });

  it("returns false when no block row", async () => {
    send.mockResolvedValueOnce({});
    await expect(isWhatsAppReplyBlocked("+1", "+2")).resolves.toBe(false);
  });

  it("writes BLOCK with 1h TTL", async () => {
    send.mockResolvedValueOnce({});
    const now = new Date("2026-11-24T18:00:00.000Z");
    await putWhatsAppReplyBlock("+593987785492", "+15551866905", now);
    expect(send).toHaveBeenCalledWith(expect.any(PutCommand));
    const item = send.mock.calls[0][0].input.Item;
    expect(item.PK).toBe("BLOCK#+593987785492#+15551866905");
    expect(item.SK).toBe("ACTIVE");
    expect(item.entityType).toBe("REPLY_BLOCK");
    expect(item.expiresAt).toBe(
      Math.floor((now.getTime() + REPLY_BLOCK_TTL_MS) / 1000),
    );
  });
});
