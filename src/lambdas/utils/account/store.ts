import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  TransactWriteCommandInput,
  UpdateCommand,
  UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, requireTableName } from "../dynamo/client";
import {
  AccountError,
  cancellationCodes,
  isConditionalFailure,
  rethrowAccountOrDynamo,
} from "./errors";
import {
  ADDRESS_PREFIX,
  FAQ_PREFIX,
  MAX_ADDRESSES,
  MAX_CONVERSATIONS_PER_MONTH,
  MAX_FAQS,
  PHONE_SK,
  PRODUCT_PREFIX,
  PROFILE_SK,
  accountPk,
  addressSk,
  createEntityId,
  faqSk,
  isEntityId,
  phonePk,
  productSk,
} from "./keys";
import {
  AccountPlan,
  AddressWrite,
  FaqWrite,
  ProductPage,
  ProductWrite,
  ProfileWrite,
  PublicAddress,
  PublicFaq,
  PublicProduct,
  PublicProfile,
  ScheduleMode,
  ScheduleWindow,
} from "./types";

interface ProfileItem {
  PK: string;
  SK: string;
  entityType: "PROFILE";
  accountId: string;
  email: string;
  businessName: string;
  phoneE164: string;
  /** @deprecated Kept for existing DynamoDB records; no longer written or returned. */
  whatsappBusinessInUse?: boolean;
  plan?: AccountPlan;
  contactName: string;
  contactPhoneE164: string | null;
  scheduleMode: ScheduleMode;
  hours: ScheduleWindow[];
  faqCount: number;
  /** New conversation threads in conversationsMonth (UTC YYYY-MM). */
  conversationsThisMonth?: number;
  conversationsMonth?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationQuotaResult {
  allowed: boolean;
  count: number;
  month: string;
  limit: number;
}

interface AddressItem {
  PK: string;
  SK: string;
  entityType: "ADDRESS";
  accountId: string;
  addressId: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  hours: ScheduleWindow[];
  createdAt: string;
  updatedAt: string;
}

interface ProductItem {
  PK: string;
  SK: string;
  entityType: "PRODUCT";
  accountId: string;
  productId: string;
  name: string;
  description: string | null;
  kind?: "product" | "service";
  priceMinor: number;
  priceRules?: string | null;
  pricingRules?: string | null;
  plans?: Array<{ name: string; priceMinor: number; rules: string | null }>;
  currency: string;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
}

interface FaqItem {
  PK: string;
  SK: string;
  entityType: "FAQ";
  accountId: string;
  faqId: string;
  question: string;
  answer: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

export interface AccountStore {
  getProfile(accountId: string): Promise<PublicProfile | null>;
  /** O(1) PHONE#{e164} lookup. Returns the Cognito account id or null. */
  findAccountIdByPhone(phoneE164: string): Promise<string | null>;
  saveProfile(
    accountId: string,
    email: string,
    input: ProfileWrite,
  ): Promise<{ profile: PublicProfile; created: boolean }>;
  listAddresses(accountId: string): Promise<PublicAddress[]>;
  createAddress(accountId: string, input: AddressWrite): Promise<PublicAddress>;
  getAddress(accountId: string, addressId: string): Promise<PublicAddress | null>;
  saveAddress(
    accountId: string,
    addressId: string,
    input: AddressWrite,
  ): Promise<PublicAddress>;
  deleteAddress(accountId: string, addressId: string): Promise<void>;
  listProducts(
    accountId: string,
    query: { limit: number; cursor?: string },
  ): Promise<ProductPage>;
  createProduct(accountId: string, input: ProductWrite): Promise<PublicProduct>;
  getProduct(accountId: string, productId: string): Promise<PublicProduct | null>;
  saveProduct(
    accountId: string,
    productId: string,
    input: ProductWrite,
  ): Promise<PublicProduct>;
  deleteProduct(accountId: string, productId: string): Promise<void>;
  listFaqs(accountId: string): Promise<PublicFaq[]>;
  createFaq(accountId: string, input: FaqWrite): Promise<PublicFaq>;
  getFaq(accountId: string, faqId: string): Promise<PublicFaq | null>;
  saveFaq(accountId: string, faqId: string, input: FaqWrite): Promise<PublicFaq>;
  deleteFaq(accountId: string, faqId: string): Promise<void>;
  /**
   * Atomically consumes one new-conversation slot for the current UTC month.
   * Lazy-resets the counter when the calendar month rolls over.
   */
  consumeConversationQuota(accountId: string): Promise<ConversationQuotaResult>;
}

export function createStore(
  doc: DynamoDBDocumentClient,
  tableName: string,
): AccountStore {
  return {
    getProfile: (accountId) => getProfile(doc, tableName, accountId),
    findAccountIdByPhone: (phoneE164) =>
      findAccountIdByPhone(doc, tableName, phoneE164),
    saveProfile: (accountId, email, input) =>
      saveProfile(doc, tableName, accountId, email, input),
    consumeConversationQuota: (accountId) =>
      consumeConversationQuota(doc, tableName, accountId),
    listAddresses: (accountId) => listAddresses(doc, tableName, accountId),
    createAddress: (accountId, input) => createAddress(doc, tableName, accountId, input),
    getAddress: (accountId, addressId) => getAddress(doc, tableName, accountId, addressId),
    saveAddress: (accountId, addressId, input) =>
      saveAddress(doc, tableName, accountId, addressId, input),
    deleteAddress: (accountId, addressId) =>
      deleteOwnedItem(doc, tableName, accountId, addressSk(addressId), "Address", "ADDRESS_NOT_FOUND"),
    listProducts: (accountId, query) => listProducts(doc, tableName, accountId, query),
    createProduct: (accountId, input) => createProduct(doc, tableName, accountId, input),
    getProduct: (accountId, productId) => getProduct(doc, tableName, accountId, productId),
    saveProduct: (accountId, productId, input) =>
      saveProduct(doc, tableName, accountId, productId, input),
    deleteProduct: (accountId, productId) =>
      deleteOwnedItem(doc, tableName, accountId, productSk(productId), "Product", "PRODUCT_NOT_FOUND"),
    listFaqs: (accountId) => listFaqs(doc, tableName, accountId),
    createFaq: (accountId, input) => createFaq(doc, tableName, accountId, input),
    getFaq: (accountId, faqId) => getFaq(doc, tableName, accountId, faqId),
    saveFaq: (accountId, faqId, input) => saveFaq(doc, tableName, accountId, faqId, input),
    deleteFaq: (accountId, faqId) => deleteFaq(doc, tableName, accountId, faqId),
  };
}

let cached: AccountStore | undefined;

export function defaultStore(): AccountStore {
  if (!cached) cached = createStore(getDocumentClient(), requireTableName());
  return cached;
}

async function getProfile(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
): Promise<PublicProfile | null> {
  const item = await getProfileItem(doc, tableName, accountId);
  return item ? toPublicProfile(item) : null;
}

async function findAccountIdByPhone(
  doc: DynamoDBDocumentClient,
  tableName: string,
  phoneE164: string,
): Promise<string | null> {
  const item = await getItem(doc, tableName, phonePk(phoneE164), PHONE_SK);
  if (!item || typeof item.accountId !== "string" || !item.accountId) return null;
  return item.accountId;
}

async function saveProfile(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  email: string,
  input: ProfileWrite,
): Promise<{ profile: PublicProfile; created: boolean }> {
  const sanitized: ProfileWrite = {
    ...input,
    hours: sanitizeHoursForStorage(input.hours),
  };
  await assertHourProductIds(doc, tableName, accountId, sanitized.hours);
  const current = await getProfileItem(doc, tableName, accountId);
  if (!current) {
    try {
      const profile = await insertProfile(doc, tableName, accountId, email, sanitized);
      return { profile, created: true };
    } catch (error) {
      if (error instanceof AccountError && error.code === "ACCOUNT_EXISTS") {
        const raced = await getProfileItem(doc, tableName, accountId);
        if (!raced) throw error;
        return {
          profile: await replaceProfile(doc, tableName, raced, sanitized),
          created: false,
        };
      }
      rethrowAccountOrDynamo(error);
    }
  }
  return {
    profile: await replaceProfile(doc, tableName, current, sanitized),
    created: false,
  };
}

async function insertProfile(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  email: string,
  input: ProfileWrite,
): Promise<PublicProfile> {
  const timestamp = nowIso();
  const profile = profileItem(accountId, email, input, timestamp, timestamp, 0);
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: profile,
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: phoneItem(accountId, input.phone),
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      }),
    );
  } catch (error) {
    const codes = cancellationCodes(error);
    if (codes?.[0] === "ConditionalCheckFailed") {
      throw new AccountError("Account profile already exists", 409, "ACCOUNT_EXISTS");
    }
    if (codes?.[1] === "ConditionalCheckFailed") {
      throw new AccountError(
        "This phone number is already used by another account",
        409,
        "PHONE_IN_USE",
      );
    }
    rethrowAccountOrDynamo(error);
  }
  return toPublicProfile(profile);
}

async function replaceProfile(
  doc: DynamoDBDocumentClient,
  tableName: string,
  current: ProfileItem,
  input: ProfileWrite,
): Promise<PublicProfile> {
  const timestamp = nowIso();
  const phoneChanged = current.phoneE164 !== input.phone;
  const switchingToBusiness =
    current.scheduleMode !== "business" && input.scheduleMode === "business";
  const hours =
    input.scheduleMode === "business" ? sanitizeHoursForStorage(input.hours) : [];
  const next: ProfileItem = {
    ...current,
    businessName: input.businessName,
    phoneE164: input.phone,
    contactName: input.contactName,
    contactPhoneE164: input.contactPhone,
    scheduleMode: input.scheduleMode,
    hours,
    plan: input.plan,
    updatedAt: timestamp,
  };

  let updateExpr =
    "SET businessName = :businessName, phoneE164 = :phoneE164, contactName = :contactName, contactPhoneE164 = :contactPhoneE164, scheduleMode = :scheduleMode, hours = :hours, updatedAt = :updatedAt REMOVE whatsappBusinessInUse";
  const exprValues: Record<string, unknown> = {
    ":businessName": next.businessName,
    ":phoneE164": next.phoneE164,
    ":contactName": next.contactName,
    ":contactPhoneE164": next.contactPhoneE164,
    ":scheduleMode": next.scheduleMode,
    ":hours": next.hours,
    ":updatedAt": next.updatedAt,
    ":accountId": current.accountId,
    ":currentPhone": current.phoneE164,
  };
  if (input.plan !== undefined) {
    updateExpr = updateExpr.replace(" REMOVE", ", plan = :plan REMOVE");
    exprValues[":plan"] = input.plan;
  }

  const items: TransactItem[] = [
    {
      Update: {
        TableName: tableName,
        Key: { PK: current.PK, SK: current.SK },
        UpdateExpression: updateExpr,
        ConditionExpression: "accountId = :accountId AND phoneE164 = :currentPhone",
        ExpressionAttributeValues: exprValues,
      },
    },
  ];

  if (phoneChanged) {
    items.push({
      Put: {
        TableName: tableName,
        Item: phoneItem(current.accountId, input.phone),
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
    items.push({
      Delete: {
        TableName: tableName,
        Key: { PK: phonePk(current.phoneE164), SK: PHONE_SK },
        ConditionExpression: "accountId = :accountId",
        ExpressionAttributeValues: { ":accountId": current.accountId },
      },
    });
  }

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (error) {
    const codes = cancellationCodes(error);
    if (codes) {
      if (codes.some((code) => code === "ValidationError")) {
        rethrowAccountOrDynamo(error);
      }
      if (phoneChanged && codes[1] === "ConditionalCheckFailed") {
        throw new AccountError(
          "This phone number is already used by another account",
          409,
          "PHONE_IN_USE",
        );
      }
      throw new AccountError(
        "Account profile was updated by another request",
        409,
        "PROFILE_CONFLICT",
      );
    }
    rethrowAccountOrDynamo(error);
  }

  if (switchingToBusiness) {
    try {
      await clearAddressHours(doc, tableName, current.accountId, timestamp);
    } catch (error) {
      rethrowAccountOrDynamo(error);
    }
  }
  return toPublicProfile(next);
}

async function listAddresses(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
): Promise<PublicAddress[]> {
  const profile = await requireProfileItem(doc, tableName, accountId);
  const items = await queryPrefix(doc, tableName, accountId, ADDRESS_PREFIX);
  return items
    .map((item) => toPublicAddress(asAddress(item), profile.scheduleMode))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function createAddress(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  input: AddressWrite,
): Promise<PublicAddress> {
  const profile = await requireProfileItem(doc, tableName, accountId);
  const sanitized: AddressWrite = {
    ...input,
    hours: sanitizeHoursForStorage(input.hours),
  };
  await assertHourProductIds(doc, tableName, accountId, sanitized.hours);
  const existing = await queryPrefix(doc, tableName, accountId, ADDRESS_PREFIX);
  if (existing.length >= MAX_ADDRESSES) {
    throw new AccountError(
      `An account can have at most ${MAX_ADDRESSES} addresses`,
      409,
      "ADDRESS_LIMIT",
    );
  }
  const timestamp = nowIso();
  const item = addressItem(
    accountId,
    createEntityId(),
    storedAddressHours(profile.scheduleMode, sanitized),
    sanitized,
    timestamp,
    timestamp,
  );
  try {
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(SK)",
      }),
    );
  } catch (error) {
    if (isConditionalFailure(error)) {
      throw new AccountError("Address already exists", 409, "ADDRESS_EXISTS");
    }
    rethrowAccountOrDynamo(error);
  }
  return toPublicAddress(item, profile.scheduleMode);
}

async function getAddress(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  addressId: string,
): Promise<PublicAddress | null> {
  const profile = await requireProfileItem(doc, tableName, accountId);
  const item = await getItem(doc, tableName, accountPk(accountId), addressSk(addressId));
  if (!item) return null;
  return toPublicAddress(asAddress(item), profile.scheduleMode);
}

async function saveAddress(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  addressId: string,
  input: AddressWrite,
): Promise<PublicAddress> {
  const profile = await requireProfileItem(doc, tableName, accountId);
  const sanitized: AddressWrite = {
    ...input,
    hours: sanitizeHoursForStorage(input.hours),
  };
  await assertHourProductIds(doc, tableName, accountId, sanitized.hours);
  const current = await getItem(doc, tableName, accountPk(accountId), addressSk(addressId));
  if (!current) {
    throw new AccountError("Address not found", 404, "ADDRESS_NOT_FOUND");
  }
  const existing = asAddress(current);
  const timestamp = nowIso();
  const hours = storedAddressHours(profile.scheduleMode, sanitized);
  try {
    await updateOwned(doc, {
      TableName: tableName,
      Key: { PK: existing.PK, SK: existing.SK },
      // `region` is a DynamoDB reserved keyword — must use ExpressionAttributeNames.
      UpdateExpression:
        "SET label = :label, line1 = :line1, line2 = :line2, city = :city, #region = :region, postalCode = :postalCode, country = :country, hours = :hours, updatedAt = :updatedAt",
      ConditionExpression: "accountId = :accountId",
      ExpressionAttributeNames: { "#region": "region" },
      ExpressionAttributeValues: {
        ":label": sanitized.label,
        ":line1": sanitized.line1,
        ":line2": sanitized.line2,
        ":city": sanitized.city,
        ":region": sanitized.region,
        ":postalCode": sanitized.postalCode,
        ":country": sanitized.country,
        ":hours": hours,
        ":updatedAt": timestamp,
        ":accountId": accountId,
      },
    }, "Address not found", "ADDRESS_NOT_FOUND");
  } catch (error) {
    rethrowAccountOrDynamo(error);
  }
  return toPublicAddress(
    { ...existing, ...sanitized, hours, updatedAt: timestamp },
    profile.scheduleMode,
  );
}

async function listProducts(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  query: { limit: number; cursor?: string },
): Promise<ProductPage> {
  await requireProfileItem(doc, tableName, accountId);
  const page = await doc.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": accountPk(accountId),
        ":sk": PRODUCT_PREFIX,
      },
      Limit: query.limit,
      ExclusiveStartKey: query.cursor
        ? decodeProductCursor(query.cursor, accountId)
        : undefined,
      ScanIndexForward: true,
    }),
  );
  return {
    items: ((page.Items as Record<string, unknown>[] | undefined) ?? []).map((item) =>
      toPublicProduct(asProduct(item)),
    ),
    nextCursor: encodeCursor(page.LastEvaluatedKey as Record<string, unknown> | undefined),
  };
}

async function createProduct(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  input: ProductWrite,
): Promise<PublicProduct> {
  await requireProfileItem(doc, tableName, accountId);
  const timestamp = nowIso();
  const item = productItem(accountId, createEntityId(), input, timestamp, timestamp);
  await doc.send(new PutCommand({ TableName: tableName, Item: item }));
  return toPublicProduct(item);
}

async function getProduct(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  productId: string,
): Promise<PublicProduct | null> {
  await requireProfileItem(doc, tableName, accountId);
  const item = await getItem(doc, tableName, accountPk(accountId), productSk(productId));
  return item ? toPublicProduct(asProduct(item)) : null;
}

async function saveProduct(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  productId: string,
  input: ProductWrite,
): Promise<PublicProduct> {
  await requireProfileItem(doc, tableName, accountId);
  const current = await getItem(doc, tableName, accountPk(accountId), productSk(productId));
  if (!current) throw new AccountError("Product not found", 404, "PRODUCT_NOT_FOUND");
  const existing = asProduct(current);
  const timestamp = nowIso();
  await updateOwned(doc, {
    TableName: tableName,
    Key: { PK: existing.PK, SK: existing.SK },
    UpdateExpression:
      "SET #name = :name, description = :description, #kind = :kind, priceMinor = :priceMinor, priceRules = :priceRules, pricingRules = :pricingRules, plans = :plans, currency = :currency, imageUrls = :imageUrls, updatedAt = :updatedAt",
    ConditionExpression: "accountId = :accountId",
    ExpressionAttributeNames: { "#name": "name", "#kind": "kind" },
    ExpressionAttributeValues: {
      ":name": input.name,
      ":description": input.description,
      ":kind": input.kind ?? "service",
      ":priceMinor": input.priceMinor,
      ":priceRules": input.priceRules ?? null,
      ":pricingRules": input.pricingRules ?? null,
      ":plans": input.plans ?? [],
      ":currency": input.currency,
      ":imageUrls": input.imageUrls,
      ":updatedAt": timestamp,
      ":accountId": accountId,
    },
  }, "Product not found", "PRODUCT_NOT_FOUND");
  return toPublicProduct({
    ...existing,
    ...input,
    kind: input.kind ?? "service",
    priceRules: input.priceRules ?? null,
    pricingRules: input.pricingRules ?? null,
    plans: input.plans ?? [],
    updatedAt: timestamp,
  });
}

async function listFaqs(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
): Promise<PublicFaq[]> {
  await requireProfileItem(doc, tableName, accountId);
  const items = await queryPrefix(doc, tableName, accountId, FAQ_PREFIX);
  return items
    .map((item) => toPublicFaq(asFaq(item)))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
}

async function createFaq(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  input: FaqWrite,
): Promise<PublicFaq> {
  const profile = await requireProfileItem(doc, tableName, accountId);
  if (profile.faqCount >= MAX_FAQS) {
    throw new AccountError("An account can have at most 10 FAQs", 409, "FAQ_LIMIT");
  }
  const timestamp = nowIso();
  const item = faqItem(
    accountId,
    createEntityId(),
    input.question,
    input.answer,
    input.sortOrder ?? profile.faqCount,
    timestamp,
    timestamp,
  );
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName,
              Key: { PK: profile.PK, SK: profile.SK },
              UpdateExpression: "SET faqCount = faqCount + :one, updatedAt = :updatedAt",
              ConditionExpression:
                "accountId = :accountId AND faqCount = :current AND faqCount < :max",
              ExpressionAttributeValues: {
                ":one": 1,
                ":updatedAt": timestamp,
                ":accountId": accountId,
                ":current": profile.faqCount,
                ":max": MAX_FAQS,
              },
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: item,
              ConditionExpression: "attribute_not_exists(SK)",
            },
          },
        ],
      }),
    );
  } catch (error) {
    const codes = cancellationCodes(error);
    if (codes?.[0] === "ConditionalCheckFailed") {
      const latest = await getProfileItem(doc, tableName, accountId);
      if (!latest) {
        throw new AccountError("Account profile not found", 404, "ACCOUNT_NOT_FOUND");
      }
      if (latest.faqCount >= MAX_FAQS) {
        throw new AccountError("An account can have at most 10 FAQs", 409, "FAQ_LIMIT");
      }
      throw new AccountError("FAQ list changed, retry the request", 409, "FAQ_CONFLICT");
    }
    throw error;
  }
  return toPublicFaq(item);
}

async function getFaq(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  faqId: string,
): Promise<PublicFaq | null> {
  await requireProfileItem(doc, tableName, accountId);
  const item = await getItem(doc, tableName, accountPk(accountId), faqSk(faqId));
  return item ? toPublicFaq(asFaq(item)) : null;
}

async function saveFaq(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  faqId: string,
  input: FaqWrite,
): Promise<PublicFaq> {
  await requireProfileItem(doc, tableName, accountId);
  const current = await getItem(doc, tableName, accountPk(accountId), faqSk(faqId));
  if (!current) throw new AccountError("FAQ not found", 404, "FAQ_NOT_FOUND");
  const existing = asFaq(current);
  const timestamp = nowIso();
  const sortOrder = input.sortOrder ?? existing.sortOrder;
  await updateOwned(doc, {
    TableName: tableName,
    Key: { PK: existing.PK, SK: existing.SK },
    UpdateExpression:
      "SET question = :question, answer = :answer, sortOrder = :sortOrder, updatedAt = :updatedAt",
    ConditionExpression: "accountId = :accountId",
    ExpressionAttributeValues: {
      ":question": input.question,
      ":answer": input.answer,
      ":sortOrder": sortOrder,
      ":updatedAt": timestamp,
      ":accountId": accountId,
    },
  }, "FAQ not found", "FAQ_NOT_FOUND");
  return toPublicFaq({
    ...existing,
    question: input.question,
    answer: input.answer,
    sortOrder,
    updatedAt: timestamp,
  });
}

async function deleteFaq(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  faqId: string,
): Promise<void> {
  const profile = await requireProfileItem(doc, tableName, accountId);
  const timestamp = nowIso();
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: tableName,
              Key: { PK: accountPk(accountId), SK: faqSk(faqId) },
              ConditionExpression: "accountId = :accountId",
              ExpressionAttributeValues: { ":accountId": accountId },
            },
          },
          {
            Update: {
              TableName: tableName,
              Key: { PK: profile.PK, SK: profile.SK },
              UpdateExpression: "SET faqCount = faqCount - :one, updatedAt = :updatedAt",
              ConditionExpression: "accountId = :accountId AND faqCount > :zero",
              ExpressionAttributeValues: {
                ":one": 1,
                ":updatedAt": timestamp,
                ":accountId": accountId,
                ":zero": 0,
              },
            },
          },
        ],
      }),
    );
  } catch (error) {
    const codes = cancellationCodes(error);
    if (codes?.[0] === "ConditionalCheckFailed") {
      throw new AccountError("FAQ not found", 404, "FAQ_NOT_FOUND");
    }
    if (codes?.[1] === "ConditionalCheckFailed") {
      throw new AccountError("FAQ list changed, retry the request", 409, "FAQ_CONFLICT");
    }
    throw error;
  }
}

async function updateOwned(
  doc: DynamoDBDocumentClient,
  input: UpdateCommandInput,
  message: string,
  code: string,
): Promise<void> {
  try {
    await doc.send(new UpdateCommand(input));
  } catch (error) {
    if (isConditionalFailure(error)) throw new AccountError(message, 404, code);
    rethrowAccountOrDynamo(error);
  }
}

async function deleteOwnedItem(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  sortKey: string,
  label: string,
  code: string,
): Promise<void> {
  await requireProfileItem(doc, tableName, accountId);
  try {
    await doc.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: accountPk(accountId), SK: sortKey },
        ConditionExpression: "attribute_exists(SK) AND accountId = :accountId",
        ExpressionAttributeValues: { ":accountId": accountId },
      }),
    );
  } catch (error) {
    if (isConditionalFailure(error)) {
      throw new AccountError(`${label} not found`, 404, code);
    }
    throw error;
  }
}

async function clearAddressHours(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  timestamp: string,
): Promise<void> {
  const items = await queryPrefix(doc, tableName, accountId, ADDRESS_PREFIX);
  await Promise.all(
    items.map(async (item) => {
      const address = asAddress(item);
      if (address.hours.length === 0) return;
      await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: address.PK, SK: address.SK },
          UpdateExpression: "SET hours = :hours, updatedAt = :updatedAt",
          ConditionExpression: "accountId = :accountId",
          ExpressionAttributeValues: {
            ":hours": [],
            ":updatedAt": timestamp,
            ":accountId": accountId,
          },
        }),
      );
    }),
  );
}

async function getProfileItem(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
): Promise<ProfileItem | null> {
  const item = await getItem(doc, tableName, accountPk(accountId), PROFILE_SK);
  return item ? asProfile(item) : null;
}

async function requireProfileItem(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
): Promise<ProfileItem> {
  const item = await getProfileItem(doc, tableName, accountId);
  if (!item) throw new AccountError("Account profile not found", 404, "ACCOUNT_NOT_FOUND");
  return item;
}

async function getItem(
  doc: DynamoDBDocumentClient,
  tableName: string,
  pk: string,
  sk: string,
): Promise<Record<string, unknown> | null> {
  const result = await doc.send(
    new GetCommand({ TableName: tableName, Key: { PK: pk, SK: sk } }),
  );
  return (result.Item as Record<string, unknown> | undefined) ?? null;
}

async function queryPrefix(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  prefix: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": accountPk(accountId),
          ":sk": prefix,
        },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((page.Items as Record<string, unknown>[] | undefined) ?? []));
    startKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (items.length > 500) {
      throw new AccountError("Too many records to read at once", 400, "LIMIT_EXCEEDED");
    }
  } while (startKey);
  return items;
}

function storedAddressHours(mode: ScheduleMode, input: AddressWrite): ScheduleWindow[] {
  if (mode === "business") {
    if (input.hours.length > 0) {
      throw new AccountError(
        "Hours belong on the account when scheduleMode is business",
        400,
        "SCHEDULE_MODE_CONFLICT",
      );
    }
    return [];
  }
  return input.hours;
}

function profileItem(
  accountId: string,
  email: string,
  input: ProfileWrite,
  createdAt: string,
  updatedAt: string,
  faqCount: number,
): ProfileItem {
  return {
    PK: accountPk(accountId),
    SK: PROFILE_SK,
    entityType: "PROFILE",
    accountId,
    email,
    businessName: input.businessName,
    phoneE164: input.phone,
    contactName: input.contactName,
    contactPhoneE164: input.contactPhone,
    scheduleMode: input.scheduleMode,
    hours:
      input.scheduleMode === "business" ? sanitizeHoursForStorage(input.hours) : [],
    plan: input.plan,
    faqCount,
    conversationsThisMonth: 0,
    conversationsMonth: utcMonthKey(),
    createdAt,
    updatedAt,
  };
}

/** UTC `YYYY-MM` used for monthly conversation quota resets. */
export function utcMonthKey(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Reserves one new WhatsApp conversation for this UTC month (max 100).
 * Counter resets lazily on first use after the 1st of the month.
 */
async function consumeConversationQuota(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
): Promise<ConversationQuotaResult> {
  const month = utcMonthKey();
  const limit = MAX_CONVERSATIONS_PER_MONTH;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const item = await getProfileItem(doc, tableName, accountId);
    if (!item) {
      throw new AccountError("Account profile not found", 404, "PROFILE_NOT_FOUND");
    }

    const sameMonth = item.conversationsMonth === month;
    const current = sameMonth ? Number(item.conversationsThisMonth ?? 0) : 0;
    if (current >= limit) {
      return { allowed: false, count: current, month, limit };
    }

    const next = current + 1;
    try {
      if (sameMonth) {
        await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: accountPk(accountId), SK: PROFILE_SK },
            UpdateExpression:
              "SET conversationsThisMonth = :next, conversationsMonth = :month, updatedAt = :updatedAt",
            ConditionExpression:
              "attribute_exists(PK) AND conversationsMonth = :month AND (conversationsThisMonth = :current OR (attribute_not_exists(conversationsThisMonth) AND :current = :zero))",
            ExpressionAttributeValues: {
              ":next": next,
              ":month": month,
              ":current": current,
              ":zero": 0,
              ":updatedAt": new Date().toISOString(),
            },
          }),
        );
      } else if (typeof item.conversationsMonth === "string") {
        await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: accountPk(accountId), SK: PROFILE_SK },
            UpdateExpression:
              "SET conversationsThisMonth = :next, conversationsMonth = :month, updatedAt = :updatedAt",
            ConditionExpression:
              "attribute_exists(PK) AND conversationsMonth = :prevMonth",
            ExpressionAttributeValues: {
              ":next": next,
              ":month": month,
              ":prevMonth": item.conversationsMonth,
              ":updatedAt": new Date().toISOString(),
            },
          }),
        );
      } else {
        await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: accountPk(accountId), SK: PROFILE_SK },
            UpdateExpression:
              "SET conversationsThisMonth = :next, conversationsMonth = :month, updatedAt = :updatedAt",
            ConditionExpression:
              "attribute_exists(PK) AND attribute_not_exists(conversationsMonth)",
            ExpressionAttributeValues: {
              ":next": next,
              ":month": month,
              ":updatedAt": new Date().toISOString(),
            },
          }),
        );
      }
      return { allowed: true, count: next, month, limit };
    } catch (error) {
      if (!isConditionalFailure(error)) rethrowAccountOrDynamo(error);
    }
  }

  throw new AccountError(
    "Failed to update conversation quota",
    500,
    "INTERNAL_ERROR",
  );
}

function phoneItem(accountId: string, phone: string) {
  return {
    PK: phonePk(phone),
    SK: PHONE_SK,
    entityType: "PHONE",
    accountId,
    phoneE164: phone,
  };
}

function addressItem(
  accountId: string,
  addressId: string,
  hours: ScheduleWindow[],
  input: AddressWrite,
  createdAt: string,
  updatedAt: string,
): AddressItem {
  return {
    PK: accountPk(accountId),
    SK: addressSk(addressId),
    entityType: "ADDRESS",
    accountId,
    addressId,
    label: input.label,
    line1: input.line1,
    line2: input.line2,
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    country: input.country,
    hours,
    createdAt,
    updatedAt,
  };
}

function productItem(
  accountId: string,
  productId: string,
  input: ProductWrite,
  createdAt: string,
  updatedAt: string,
): ProductItem {
  return {
    PK: accountPk(accountId),
    SK: productSk(productId),
    entityType: "PRODUCT",
    accountId,
    productId,
    name: input.name,
    description: input.description,
    kind: input.kind ?? "service",
    priceMinor: input.priceMinor,
    priceRules: input.priceRules ?? null,
    pricingRules: input.pricingRules ?? null,
    plans: input.plans ?? [],
    currency: input.currency,
    imageUrls: input.imageUrls,
    createdAt,
    updatedAt,
  };
}

function faqItem(
  accountId: string,
  faqId: string,
  question: string,
  answer: string,
  sortOrder: number,
  createdAt: string,
  updatedAt: string,
): FaqItem {
  return {
    PK: accountPk(accountId),
    SK: faqSk(faqId),
    entityType: "FAQ",
    accountId,
    faqId,
    question,
    answer,
    sortOrder,
    createdAt,
    updatedAt,
  };
}

function toPublicProfile(item: ProfileItem): PublicProfile {
  const month = utcMonthKey();
  const sameMonth = item.conversationsMonth === month;
  return {
    accountId: item.accountId,
    email: item.email,
    businessName: item.businessName,
    phone: item.phoneE164,
    contactName: item.contactName,
    contactPhone: item.contactPhoneE164,
    scheduleMode: item.scheduleMode,
    hours: item.scheduleMode === "business" ? normalizeHours(item.hours) : [],
    conversationsThisMonth: sameMonth ? Number(item.conversationsThisMonth ?? 0) : 0,
    conversationsMonth: month,
    conversationsMonthlyLimit: MAX_CONVERSATIONS_PER_MONTH,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    plan: item.plan ?? null,
  };
}

function toPublicAddress(item: AddressItem, mode: ScheduleMode): PublicAddress {
  return {
    id: item.addressId,
    label: item.label,
    line1: item.line1,
    line2: item.line2,
    city: item.city,
    region: item.region,
    postalCode: item.postalCode,
    country: item.country,
    hours: mode === "per_address" ? normalizeHours(item.hours) : [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeHours(hours: ScheduleWindow[] | undefined): ScheduleWindow[] {
  return sanitizeHoursForStorage(Array.isArray(hours) ? hours : []);
}

/**
 * Persist only real product links. Omitting productId means "all services".
 * Nested `productId: null` on Dynamo list maps has caused DocumentClient/
 * ValidationException 500s, so strip null/empty before every write.
 */
function sanitizeHoursForStorage(hours: ScheduleWindow[]): ScheduleWindow[] {
  return hours.map((window) => {
    const next: ScheduleWindow = {
      dayOfWeek: window.dayOfWeek,
      start: window.start,
      end: window.end,
    };
    if (typeof window.productId === "string" && window.productId.trim()) {
      next.productId = window.productId.trim();
    }
    return next;
  });
}

async function assertHourProductIds(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  hours: ScheduleWindow[],
): Promise<void> {
  const ids = [
    ...new Set(
      hours
        .map((window) => window.productId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  for (const productId of ids) {
    const item = await getItem(doc, tableName, accountPk(accountId), productSk(productId));
    if (!item || item.entityType !== "PRODUCT") {
      throw new AccountError(
        "hours.productId must refer to a product on this account",
        400,
        "INVALID_HOURS",
        { field: "productId", productId },
      );
    }
  }
}

function toPublicProduct(item: ProductItem): PublicProduct {
  return {
    id: item.productId,
    name: item.name,
    description: item.description,
    kind: item.kind ?? "service",
    priceMinor: item.priceMinor,
    priceRules: item.priceRules ?? null,
    pricingRules: item.pricingRules ?? null,
    plans: item.plans ?? [],
    currency: item.currency,
    imageUrls: item.imageUrls ?? [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toPublicFaq(item: FaqItem): PublicFaq {
  return {
    id: item.faqId,
    question: item.question,
    answer: item.answer,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function asProfile(item: Record<string, unknown>): ProfileItem {
  if (item.entityType !== "PROFILE" || typeof item.accountId !== "string") {
    throw corrupt();
  }
  return item as unknown as ProfileItem;
}

function asAddress(item: Record<string, unknown>): AddressItem {
  if (item.entityType !== "ADDRESS" || typeof item.addressId !== "string") throw corrupt();
  return item as unknown as AddressItem;
}

function asProduct(item: Record<string, unknown>): ProductItem {
  if (item.entityType !== "PRODUCT" || typeof item.productId !== "string") throw corrupt();
  return item as unknown as ProductItem;
}

function asFaq(item: Record<string, unknown>): FaqItem {
  if (item.entityType !== "FAQ" || typeof item.faqId !== "string") throw corrupt();
  return item as unknown as FaqItem;
}

function corrupt(): AccountError {
  return new AccountError("Stored account data is invalid", 500, "DATA_CORRUPT");
}

function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  if (!key) return null;
  return Buffer.from(JSON.stringify({ PK: key.PK, SK: key.SK }), "utf8").toString("base64url");
}

function decodeProductCursor(cursor: string, accountId: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new AccountError("Invalid cursor", 400, "INVALID_CURSOR");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AccountError("Invalid cursor", 400, "INVALID_CURSOR");
  }
  const key = parsed as Record<string, unknown>;
  const pk = accountPk(accountId);
  const sk = key.SK;
  if (
    key.PK !== pk ||
    typeof sk !== "string" ||
    !sk.startsWith(PRODUCT_PREFIX) ||
    !isEntityId(sk.slice(PRODUCT_PREFIX.length))
  ) {
    throw new AccountError("Invalid cursor", 400, "INVALID_CURSOR");
  }
  return { PK: pk, SK: sk };
}

function nowIso(): string {
  return new Date().toISOString();
}
