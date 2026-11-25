import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createStore } from "./store";
import { accountPk, PROFILE_SK } from "./keys";
import { ProductWrite, ProfileWrite } from "./types";

const business: ProfileWrite = {
  businessName: "Ada Gym",
  phone: "+15551234567",
  contactName: "Ada Lovelace",
  contactPhone: null,
  scheduleMode: "business",
  hours: [{ dayOfWeek: "monday", start: "09:00", end: "17:00" }],
};

function profileItem(overrides: Record<string, unknown> = {}) {
  return {
    PK: accountPk("user-1"),
    SK: PROFILE_SK,
    entityType: "PROFILE",
    accountId: "user-1",
    email: "ada@example.com",
    businessName: "Ada Gym",
    phoneE164: "+15551234567",
    contactName: "Ada Lovelace",
    contactPhoneE164: null,
    scheduleMode: "business",
    hours: [{ dayOfWeek: "monday", start: "09:00", end: "17:00" }],
    faqCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function canceled(reasons: string[]): Error {
  const error = new Error("cancelled");
  error.name = "TransactionCanceledException";
  (error as Error & { CancellationReasons: { Code: string }[] }).CancellationReasons =
    reasons.map((code) => ({ Code: code }));
  return error;
}

function commands(send: jest.Mock, type: new (...args: never[]) => unknown) {
  return send.mock.calls
    .map((call) => call[0])
    .filter((command) => command instanceof type);
}

describe("account store", () => {
  it("creates the profile and claims the phone in one transaction", async () => {
    const send = jest.fn(async (command: { constructor: { name: string } }) => {
      if (command instanceof GetCommand) return {};
      if (command instanceof TransactWriteCommand) return {};
      throw new Error(`unexpected ${command.constructor.name}`);
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    const saved = await store.saveProfile("user-1", "ada@example.com", business);

    expect(saved.created).toBe(true);
    expect(saved.profile.email).toBe("ada@example.com");
    const transact = commands(send, TransactWriteCommand)[0] as TransactWriteCommand;
    expect(transact.input.TransactItems).toHaveLength(2);
    expect(transact.input.TransactItems?.[0].Put?.Item).toMatchObject({
      PK: "ACC#user-1",
      SK: "PROFILE",
      email: "ada@example.com",
      phoneE164: "+15551234567",
    });
    expect(transact.input.TransactItems?.[1].Put?.Item).toMatchObject({
      PK: "PHONE#+15551234567",
      accountId: "user-1",
    });
    expect(transact.input.TransactItems?.[1].Put?.ConditionExpression).toBe(
      "attribute_not_exists(PK)",
    );
  });

  it("rejects a phone already claimed by another account", async () => {
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) return {};
      if (command instanceof TransactWriteCommand) {
        throw canceled(["None", "ConditionalCheckFailed"]);
      }
      throw new Error("unexpected");
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    await expect(store.saveProfile("user-1", "ada@example.com", business)).rejects.toMatchObject({
      code: "PHONE_IN_USE",
      statusCode: 409,
    });
  });

  it("keeps the stored email and swaps the phone item when the number changes", async () => {
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) return { Item: profileItem() };
      if (command instanceof TransactWriteCommand) return {};
      throw new Error("unexpected");
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    const saved = await store.saveProfile("user-1", "ignored@example.com", {
      ...business,
      phone: "+15557654321",
    });

    expect(saved.created).toBe(false);
    expect(saved.profile.email).toBe("ada@example.com");
    const transact = commands(send, TransactWriteCommand)[0] as TransactWriteCommand;
    const items = transact.input.TransactItems ?? [];
    expect(items[0].Update?.UpdateExpression).not.toContain("email");
    expect(items[1].Put?.Item).toMatchObject({ PK: "PHONE#+15557654321" });
    expect(items[2].Delete?.Key).toEqual({
      PK: "PHONE#+15551234567",
      SK: "ACCOUNT",
    });
  });

  it("clears address hours when the schedule moves onto the business", async () => {
    const addressId = "m5k2abcd-0123456789ab";
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) {
        return {
          Item: profileItem({ scheduleMode: "per_address", hours: [] }),
        };
      }
      if (command instanceof TransactWriteCommand) return {};
      if (command instanceof QueryCommand) {
        return {
          Items: [
            {
              PK: accountPk("user-1"),
              SK: `ADDR#${addressId}`,
              entityType: "ADDRESS",
              accountId: "user-1",
              addressId,
              label: null,
              line1: "1 Main",
              line2: null,
              city: "Quito",
              region: null,
              postalCode: null,
              country: "EC",
              hours: [{ dayOfWeek: "monday", start: "09:00", end: "17:00" }],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (command instanceof UpdateCommand) return {};
      throw new Error("unexpected");
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    await store.saveProfile("user-1", "ada@example.com", business);

    const update = commands(send, UpdateCommand)[0] as UpdateCommand;
    expect(update.input.Key).toEqual({
      PK: "ACC#user-1",
      SK: `ADDR#${addressId}`,
    });
    expect(update.input.ExpressionAttributeValues?.[":hours"]).toEqual([]);
  });

  it("stops at 10 FAQs and conditions the counter below that cap", async () => {
    const full = jest.fn(async () => ({ Item: profileItem({ faqCount: 10 }) }));
    const fullStore = createStore(
      { send: full } as unknown as DynamoDBDocumentClient,
      "RespondiBe-test",
    );
    await expect(
      fullStore.createFaq("user-1", { question: "Hours?", answer: "Nine to five." }),
    ).rejects.toMatchObject({ code: "FAQ_LIMIT" });
    expect(commands(full, TransactWriteCommand)).toHaveLength(0);

    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) return { Item: profileItem({ faqCount: 9 }) };
      if (command instanceof TransactWriteCommand) return {};
      throw new Error("unexpected");
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");
    await store.createFaq("user-1", { question: "Hours?", answer: "Nine to five." });
    const transact = commands(send, TransactWriteCommand)[0] as TransactWriteCommand;
    expect(transact.input.TransactItems?.[0].Update?.ConditionExpression).toContain(
      "faqCount < :max",
    );
    expect(transact.input.TransactItems?.[0].Update?.ExpressionAttributeValues?.[":max"]).toBe(10);
  });

  it("rejects a product cursor for another account", async () => {
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) return { Item: profileItem() };
      throw new Error(`unexpected ${command.constructor.name}`);
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");
    const cursor = Buffer.from(
      JSON.stringify({
        PK: "ACC#someone-else",
        SK: "PROD#m5k2abcd-0123456789ab",
      }),
    ).toString("base64url");

    await expect(store.listProducts("user-1", { limit: 20, cursor })).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
  });

  it("deletes an address only inside the caller's partition", async () => {
    const addressId = "m5k2abcd-0123456789ab";
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) return { Item: profileItem() };
      if (command instanceof DeleteCommand) return {};
      throw new Error("unexpected");
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    await store.deleteAddress("user-1", addressId);

    const deleted = commands(send, DeleteCommand)[0] as DeleteCommand;
    expect(deleted.input.Key).toEqual({
      PK: "ACC#user-1",
      SK: `ADDR#${addressId}`,
    });
    expect(deleted.input.ExpressionAttributeValues).toEqual({ ":accountId": "user-1" });
  });

  it("persists schedule hours with and without productId and strips null productId", async () => {
    const productId = "m5k2abcd-0123456789ab";
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) {
        const key = (command as GetCommand).input.Key;
        if (key?.SK === PROFILE_SK) return { Item: profileItem() };
        if (key?.SK === `PROD#${productId}`) {
          return {
            Item: {
              PK: accountPk("user-1"),
              SK: `PROD#${productId}`,
              entityType: "PRODUCT",
              accountId: "user-1",
              productId,
            },
          };
        }
        return {};
      }
      if (command instanceof TransactWriteCommand) return {};
      throw new Error("unexpected");
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    const saved = await store.saveProfile("user-1", "ada@example.com", {
      ...business,
      hours: [
        { dayOfWeek: "monday", start: "06:00", end: "10:00", productId },
        { dayOfWeek: "monday", start: "17:00", end: "20:00", productId: null },
        { dayOfWeek: "tuesday", start: "09:00", end: "12:00" },
      ],
    });

    const transact = commands(send, TransactWriteCommand)[0] as TransactWriteCommand;
    const hours = transact.input.TransactItems?.[0].Update?.ExpressionAttributeValues?.[
      ":hours"
    ] as Array<Record<string, unknown>>;
    expect(hours).toEqual([
      { dayOfWeek: "monday", start: "06:00", end: "10:00", productId },
      { dayOfWeek: "monday", start: "17:00", end: "20:00" },
      { dayOfWeek: "tuesday", start: "09:00", end: "12:00" },
    ]);
    expect(saved.profile.hours).toEqual(hours);
  });

  it("rejects hours.productId that is not a product on the account", async () => {
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) {
        const key = (command as GetCommand).input.Key;
        if (key?.SK === PROFILE_SK) return { Item: profileItem() };
        return {};
      }
      throw new Error("unexpected");
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    await expect(
      store.saveProfile("user-1", "ada@example.com", {
        ...business,
        hours: [
          {
            dayOfWeek: "monday",
            start: "09:00",
            end: "17:00",
            productId: "missing0-0123456789ab",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_HOURS", statusCode: 400 });
    expect(commands(send, TransactWriteCommand)).toHaveLength(0);
  });

  it("finds an account id from the PHONE# lookup item", async () => {
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) {
        return {
          Item: {
            PK: "PHONE#+15550783881",
            SK: "ACCOUNT",
            entityType: "PHONE",
            accountId: "user-1",
            phoneE164: "+15550783881",
          },
        };
      }
      throw new Error("unexpected");
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    await expect(store.findAccountIdByPhone("+15550783881")).resolves.toBe("user-1");
    const get = commands(send, GetCommand)[0] as GetCommand;
    expect(get.input.Key).toEqual({ PK: "PHONE#+15550783881", SK: "ACCOUNT" });
  });

  it("round-trips product kind, plans, and pricing rules on create then get", async () => {
    const write: ProductWrite = {
      name: "Mensual",
      description: "Acceso al gym",
      kind: "service",
      priceMinor: 5000,
      priceRules: null,
      pricingRules: "Inscripción anual aparte",
      plans: [
        { name: "Mensual", priceMinor: 5000, rules: "Congelación 1 vez/año" },
        { name: "Trimestral", priceMinor: 13500, rules: null },
      ],
      currency: "USD",
      imageUrls: [],
    };
    let stored: Record<string, unknown> | undefined;
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) {
        const key = (command as GetCommand).input.Key;
        if (key?.SK === PROFILE_SK) return { Item: profileItem() };
        if (key?.SK === stored?.SK) return { Item: stored };
        return {};
      }
      if (command instanceof PutCommand) {
        stored = (command as PutCommand).input.Item as Record<string, unknown>;
        return {};
      }
      if (command instanceof QueryCommand) {
        return { Items: [], Count: 0 };
      }
      throw new Error(`unexpected ${(command as { constructor: { name: string } }).constructor.name}`);
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    const created = await store.createProduct("user-1", write);
    expect(created).toMatchObject({
      name: "Mensual",
      kind: "service",
      priceMinor: 5000,
      pricingRules: "Inscripción anual aparte",
      plans: write.plans,
      currency: "USD",
      imageUrls: [],
    });

    const fetched = await store.getProduct("user-1", created.id);
    expect(fetched).toEqual(created);
  });

  it("defaults missing product catalog fields on read for old Dynamo rows", async () => {
    const productId = "m5k2abcd-0123456789ab";
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) {
        const key = (command as GetCommand).input.Key;
        if (key?.SK === PROFILE_SK) return { Item: profileItem() };
        return {
          Item: {
            PK: accountPk("user-1"),
            SK: `PROD#${productId}`,
            entityType: "PRODUCT",
            accountId: "user-1",
            productId,
            name: "Day pass",
            description: null,
            priceMinor: 1500,
            currency: "USD",
            imageUrls: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        };
      }
      throw new Error("unexpected");
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    await expect(store.getProduct("user-1", productId)).resolves.toMatchObject({
      id: productId,
      kind: "service",
      plans: [],
      priceRules: null,
      pricingRules: null,
    });
  });

  it("consumes conversation quota and blocks at the monthly limit", async () => {
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) {
        return {
          Item: profileItem({
            conversationsThisMonth: 99,
            conversationsMonth: "2026-11",
          }),
        };
      }
      if (command instanceof UpdateCommand) return {};
      throw new Error(`unexpected ${command.constructor.name}`);
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    await expect(store.consumeConversationQuota("user-1")).resolves.toEqual({
      allowed: true,
      count: 100,
      month: "2026-11",
      limit: 100,
    });

    send.mockImplementation(async (command: object) => {
      if (command instanceof GetCommand) {
        return {
          Item: profileItem({
            conversationsThisMonth: 100,
            conversationsMonth: "2026-11",
          }),
        };
      }
      throw new Error("unexpected");
    });

    await expect(store.consumeConversationQuota("user-1")).resolves.toEqual({
      allowed: false,
      count: 100,
      month: "2026-11",
      limit: 100,
    });
  });

  it("resets conversation quota when the UTC month changes", async () => {
    const send = jest.fn(async (command: object) => {
      if (command instanceof GetCommand) {
        return {
          Item: profileItem({
            conversationsThisMonth: 100,
            conversationsMonth: "2026-10",
          }),
        };
      }
      if (command instanceof UpdateCommand) return {};
      throw new Error(`unexpected ${command.constructor.name}`);
    });
    const store = createStore({ send } as unknown as DynamoDBDocumentClient, "RespondiBe-test");

    // Freeze "now" via conversationsMonth expectation: utcMonthKey() is live.
    // Stub by ensuring update runs for month rollover from 2026-10.
    const result = await store.consumeConversationQuota("user-1");
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.month).not.toBe("2026-10");
    expect(commands(send, UpdateCommand)[0].input.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":next": 1,
        ":prevMonth": "2026-10",
      }),
    );
  });
});
