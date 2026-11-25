import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  REPLY_BLOCK_ENTITY,
  REPLY_BLOCK_SK,
  REPLY_BLOCK_TTL_MS,
  replyBlockPk,
} from "../account/keys";
import { getDocumentClient, requireTableName } from "../dynamo/client";

/**
 * True when `quietPhone` must not auto-reply to inbound from `otherPhone`
 * (BLOCK#{quiet}#{other} exists and has not expired).
 */
export async function isWhatsAppReplyBlocked(
  quietPhoneE164: string,
  otherPhoneE164: string,
): Promise<boolean> {
  const result = await getDocumentClient().send(
    new GetCommand({
      TableName: requireTableName(),
      Key: {
        PK: replyBlockPk(quietPhoneE164, otherPhoneE164),
        SK: REPLY_BLOCK_SK,
      },
    }),
  );
  return Boolean(result.Item);
}

/**
 * After business `otherPhone` auto-replies to customer `quietPhone`, record that
 * `quietPhone` must not auto-reply back for one hour (Dynamo TTL).
 */
export async function putWhatsAppReplyBlock(
  quietPhoneE164: string,
  otherPhoneE164: string,
  now = new Date(),
): Promise<void> {
  const createdAt = now.toISOString();
  const expiresAt = Math.floor((now.getTime() + REPLY_BLOCK_TTL_MS) / 1000);
  await getDocumentClient().send(
    new PutCommand({
      TableName: requireTableName(),
      Item: {
        PK: replyBlockPk(quietPhoneE164, otherPhoneE164),
        SK: REPLY_BLOCK_SK,
        entityType: REPLY_BLOCK_ENTITY,
        quietPhoneE164,
        otherPhoneE164,
        createdAt,
        expiresAt,
      },
    }),
  );
}
