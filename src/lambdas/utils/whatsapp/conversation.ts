import {
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CONVERSATION_ENTITY,
  CONVERSATION_TTL_MS,
  MAX_CONVERSATION_MESSAGES,
  conversationPk,
} from "../account/keys";
import { getDocumentClient, requireTableName } from "../dynamo/client";

/** system = internal note (e.g. 422 reason); not a customer-facing WhatsApp turn. */
export type ConversationDirection = "inbound" | "outbound" | "system";

export interface ConversationMessage {
  direction: ConversationDirection;
  text: string;
  at: string;
}

export interface WhatsAppConversation {
  accountId: string;
  customerPhoneE164: string;
  /** Immutable creation time; also the Dynamo SK. */
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
  /** Present for Dynamo key ops (PK/SK). */
  pk: string;
  sk: string;
}

interface ConversationItem {
  PK: string;
  SK: string;
  entityType: typeof CONVERSATION_ENTITY;
  accountId: string;
  customerPhoneE164: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
  /** Epoch seconds — DynamoDB TTL (createdAt + 1 hour). */
  expiresAt: number;
}

/**
 * Loads the newest conversation row for this account + customer, if any.
 * SK is creation timestamp (immutable); messages are updated in place.
 */
export async function getConversation(
  accountId: string,
  customerPhoneE164: string,
): Promise<WhatsAppConversation | null> {
  const result = await getDocumentClient().send(
    new QueryCommand({
      TableName: requireTableName(),
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": conversationPk(accountId, customerPhoneE164),
      },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  const item = result.Items?.[0] as ConversationItem | undefined;
  return item ? toConversation(item) : null;
}

/**
 * Deletes every conversation row for this account + customer phone.
 * Used by Respondi test harness `startClean` so the next message starts fresh.
 */
export async function clearConversations(
  accountId: string,
  customerPhoneE164: string,
): Promise<number> {
  const client = getDocumentClient();
  const tableName = requireTableName();
  const pk = conversationPk(accountId, customerPhoneE164);
  let deleted = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ProjectionExpression: "PK, SK",
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    for (const item of page.Items ?? []) {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
        }),
      );
      deleted += 1;
    }

    exclusiveStartKey = page.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey);

  return deleted;
}

/**
 * Appends messages, keeping only the last MAX_CONVERSATION_MESSAGES.
 * Creates a new conversation (SK = now, TTL = now + 1h) when none exists.
 */
export async function appendConversationMessages(input: {
  accountId: string;
  customerPhoneE164: string;
  existing: WhatsAppConversation | null;
  messages: Array<{ direction: ConversationDirection; text: string }>;
  now?: Date;
}): Promise<WhatsAppConversation> {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const incoming = input.messages
    .map((message) => ({
      direction: message.direction,
      text: message.text.trim().slice(0, 2000),
      at,
    }))
    .filter((message) => message.text.length > 0);

  if (incoming.length === 0) {
    if (input.existing) return input.existing;
    throw new Error("Cannot create conversation with empty messages");
  }

  if (!input.existing) {
    const createdAt = at;
    const messages = trimMessages(incoming);
    const item: ConversationItem = {
      PK: conversationPk(input.accountId, input.customerPhoneE164),
      SK: createdAt,
      entityType: CONVERSATION_ENTITY,
      accountId: input.accountId,
      customerPhoneE164: input.customerPhoneE164,
      createdAt,
      updatedAt: at,
      messages,
      expiresAt: Math.floor((now.getTime() + CONVERSATION_TTL_MS) / 1000),
    };
    await getDocumentClient().send(
      new PutCommand({
        TableName: requireTableName(),
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
    return toConversation(item);
  }

  const messages = trimMessages([...input.existing.messages, ...incoming]);
  await getDocumentClient().send(
    new UpdateCommand({
      TableName: requireTableName(),
      Key: { PK: input.existing.pk, SK: input.existing.sk },
      UpdateExpression: "SET messages = :messages, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":messages": messages,
        ":updatedAt": at,
      },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );

  return {
    ...input.existing,
    messages,
    updatedAt: at,
  };
}

/** Compact history lines for Bedrock prompts. */
export function formatConversationForPrompt(
  messages: ConversationMessage[],
): string {
  if (!messages.length) return "";
  return messages
    .map((message) => {
      const who =
        message.direction === "inbound"
          ? "Customer"
          : message.direction === "outbound"
            ? "Business"
            : "System";
      return `${who}: ${message.text}`;
    })
    .join("\n");
}

function trimMessages(messages: ConversationMessage[]): ConversationMessage[] {
  if (messages.length <= MAX_CONVERSATION_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_CONVERSATION_MESSAGES);
}

function toConversation(item: ConversationItem): WhatsAppConversation {
  return {
    accountId: item.accountId,
    customerPhoneE164: item.customerPhoneE164,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messages: Array.isArray(item.messages) ? item.messages : [],
    pk: item.PK,
    sk: item.SK,
  };
}
