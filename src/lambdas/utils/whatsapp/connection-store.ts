import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { accountPk } from "../account/keys";
import { getDocumentClient, requireTableName } from "../dynamo/client";

export const WHATSAPP_SK = "WHATSAPP";

export interface WhatsAppConnection {
  accountId: string;
  wabaId: string;
  phoneNumberId: string;
  phoneE164: string;
  accessToken: string;
  connectedAt: string;
  updatedAt: string;
}

/** Safe for API responses — never includes the business access token. */
export interface PublicWhatsAppConnection {
  connected: true;
  wabaId: string;
  phoneNumberId: string;
  phoneE164: string;
  connectedAt: string;
  updatedAt: string;
}

interface WhatsAppItem {
  PK: string;
  SK: string;
  entityType: "WHATSAPP";
  accountId: string;
  wabaId: string;
  phoneNumberId: string;
  phoneE164: string;
  accessToken: string;
  connectedAt: string;
  updatedAt: string;
}

function toPublic(item: WhatsAppItem): PublicWhatsAppConnection {
  return {
    connected: true,
    wabaId: item.wabaId,
    phoneNumberId: item.phoneNumberId,
    phoneE164: item.phoneE164,
    connectedAt: item.connectedAt,
    updatedAt: item.updatedAt,
  };
}

function toConnection(item: WhatsAppItem): WhatsAppConnection {
  return {
    accountId: item.accountId,
    wabaId: item.wabaId,
    phoneNumberId: item.phoneNumberId,
    phoneE164: item.phoneE164,
    accessToken: item.accessToken,
    connectedAt: item.connectedAt,
    updatedAt: item.updatedAt,
  };
}

export async function getWhatsAppConnection(
  accountId: string,
  doc: DynamoDBDocumentClient = getDocumentClient(),
  tableName = requireTableName(),
): Promise<WhatsAppConnection | null> {
  const result = await doc.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: accountPk(accountId), SK: WHATSAPP_SK },
    }),
  );
  if (!result.Item || result.Item.entityType !== "WHATSAPP") return null;
  return toConnection(result.Item as WhatsAppItem);
}

export async function getPublicWhatsAppConnection(
  accountId: string,
): Promise<PublicWhatsAppConnection | { connected: false }> {
  const connection = await getWhatsAppConnection(accountId);
  if (!connection) return { connected: false };
  return {
    connected: true,
    wabaId: connection.wabaId,
    phoneNumberId: connection.phoneNumberId,
    phoneE164: connection.phoneE164,
    connectedAt: connection.connectedAt,
    updatedAt: connection.updatedAt,
  };
}

export async function saveWhatsAppConnection(
  input: {
    accountId: string;
    wabaId: string;
    phoneNumberId: string;
    phoneE164: string;
    accessToken: string;
    connectedAt?: string;
  },
  doc: DynamoDBDocumentClient = getDocumentClient(),
  tableName = requireTableName(),
): Promise<PublicWhatsAppConnection> {
  const now = new Date().toISOString();
  const existing = await getWhatsAppConnection(input.accountId, doc, tableName);
  const item: WhatsAppItem = {
    PK: accountPk(input.accountId),
    SK: WHATSAPP_SK,
    entityType: "WHATSAPP",
    accountId: input.accountId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    phoneE164: input.phoneE164,
    accessToken: input.accessToken,
    connectedAt: existing?.connectedAt ?? input.connectedAt ?? now,
    updatedAt: now,
  };
  await doc.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    }),
  );
  return toPublic(item);
}

export async function deleteWhatsAppConnection(
  accountId: string,
  doc: DynamoDBDocumentClient = getDocumentClient(),
  tableName = requireTableName(),
): Promise<boolean> {
  const existing = await getWhatsAppConnection(accountId, doc, tableName);
  if (!existing) return false;
  await doc.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: accountPk(accountId), SK: WHATSAPP_SK },
    }),
  );
  return true;
}
