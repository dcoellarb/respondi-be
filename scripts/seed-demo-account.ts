/**
 * Seed the CircuitFit demo account into an environment.
 *
 * Creates (or reuses) Cognito user demo@respondi.live with a fixed password,
 * then upserts profile / phone / address / products / FAQs into RespondiBe-{env}
 * using that user's Cognito `sub` as accountId.
 *
 * Usage:
 *   pnpm run seed:demo -- --env development
 *   pnpm run seed:demo -- --env staging
 *   pnpm run seed:demo -- --env production
 *
 * Options:
 *   --env <name>       development | staging | production (required)
 *   --profile <name>   AWS CLI profile (default: aws-milos-pet-club)
 *   --region <name>    AWS region (default: us-east-2)
 *   --dry-run          Print planned actions without writing
 */
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import * as fs from "fs";
import * as path from "path";

const ENVS = ["development", "staging", "production"] as const;
type EnvName = (typeof ENVS)[number];

const DEFAULT_PROFILE = "aws-milos-pet-club";
const DEFAULT_REGION = "us-east-2";
const SEED_PATH = path.join(__dirname, "seed", "demo-account.json");

interface SeedFile {
  demoUser: {
    email: string;
    password: string;
    givenName: string;
    familyName: string;
    phoneE164: string;
  };
  profile: {
    businessName: string;
    whatsappBusinessInUse: boolean;
    contactName: string;
    scheduleMode: "business" | "per_address";
    hours: Array<{
      dayOfWeek: string;
      start: string;
      end: string;
      productId?: string;
    }>;
  };
  addresses: Array<{
    id: string;
    label: string | null;
    line1: string;
    line2: string | null;
    city: string;
    region: string | null;
    postalCode: string | null;
    country: string;
    hours: Array<{
      dayOfWeek: string;
      start: string;
      end: string;
      productId?: string;
    }>;
  }>;
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    kind: "product" | "service";
    priceMinor: number;
    priceRules: string | null;
    pricingRules: string | null;
    plans: Array<{ name: string; priceMinor: number; rules: string | null }>;
    currency: string;
    imageUrls: string[];
  }>;
  faqs: Array<{
    id: string;
    question: string;
    answer: string;
    sortOrder: number;
  }>;
}

function parseArgs(argv: string[]): {
  env: EnvName;
  profile: string;
  region: string;
  dryRun: boolean;
} {
  const args = argv.filter((a) => a !== "--");
  let env: EnvName | undefined;
  let profile = process.env.AWS_PROFILE || DEFAULT_PROFILE;
  let region = process.env.AWS_REGION || DEFAULT_REGION;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--env") {
      env = args[++i] as EnvName;
    } else if (arg === "--profile") {
      profile = args[++i];
    } else if (arg === "--region") {
      region = args[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: pnpm run seed:demo -- --env <${ENVS.join("|")}> [--profile ...] [--region ...] [--dry-run]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!env || !(ENVS as readonly string[]).includes(env)) {
    throw new Error(`--env is required (${ENVS.join(" | ")})`);
  }
  return { env, profile, region, dryRun };
}

function attr(attrs: AttributeType[] | undefined, name: string): string | undefined {
  return attrs?.find((a) => a.Name === name)?.Value;
}

function utcMonthKey(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function resolveUserPoolId(
  cognito: CognitoIdentityProviderClient,
  env: EnvName,
): Promise<string> {
  const expected = `RespondiBeStack-${env}-userpool`;
  let nextToken: string | undefined;
  do {
    const page = await cognito.send(
      new ListUserPoolsCommand({ MaxResults: 60, NextToken: nextToken }),
    );
    const match = page.UserPools?.find((p) => p.Name === expected);
    if (match?.Id) return match.Id;
    nextToken = page.NextToken;
  } while (nextToken);
  throw new Error(`User pool not found: ${expected}`);
}

async function ensureCognitoUser(
  cognito: CognitoIdentityProviderClient,
  userPoolId: string,
  seed: SeedFile,
  dryRun: boolean,
): Promise<{ accountId: string; created: boolean }> {
  const { email, password, givenName, familyName } = seed.demoUser;

  try {
    const existing = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }),
    );
    const accountId = attr(existing.UserAttributes, "sub");
    if (!accountId) throw new Error(`Cognito user ${email} has no sub`);

    if (dryRun) {
      console.log(`[dry-run] would reset password for existing Cognito user ${email} (${accountId})`);
      return { accountId, created: false };
    }

    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      }),
    );
    console.log(`Reused Cognito user ${email} (${accountId}); password refreshed`);
    return { accountId, created: false };
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== "UserNotFoundException") throw error;
  }

  if (dryRun) {
    console.log(`[dry-run] would create Cognito user ${email}`);
    return { accountId: "dry-run-sub", created: true };
  }

  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "given_name", Value: givenName },
        { Name: "family_name", Value: familyName },
        { Name: "custom:authProvider", Value: "email" },
      ],
    }),
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );

  const created = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }),
  );
  const accountId = attr(created.UserAttributes, "sub");
  if (!accountId) throw new Error("Created Cognito user has no sub");
  console.log(`Created Cognito user ${email} (${accountId})`);
  return { accountId, created: true };
}

function buildItems(accountId: string, seed: SeedFile, now: string) {
  const phone = seed.demoUser.phoneE164;
  const email = seed.demoUser.email;
  const pk = `ACC#${accountId}`;

  const profile = {
    PK: pk,
    SK: "PROFILE",
    entityType: "PROFILE",
    accountId,
    email,
    businessName: seed.profile.businessName,
    phoneE164: phone,
    whatsappBusinessInUse: seed.profile.whatsappBusinessInUse,
    contactName: seed.profile.contactName,
    contactPhoneE164: phone,
    scheduleMode: seed.profile.scheduleMode,
    hours: seed.profile.scheduleMode === "business" ? seed.profile.hours : [],
    faqCount: seed.faqs.length,
    conversationsThisMonth: 0,
    conversationsMonth: utcMonthKey(),
    createdAt: now,
    updatedAt: now,
  };

  const phoneLookup = {
    PK: `PHONE#${phone}`,
    SK: "ACCOUNT",
    entityType: "PHONE",
    accountId,
    phoneE164: phone,
  };

  const addresses = seed.addresses.map((a) => ({
    PK: pk,
    SK: `ADDR#${a.id}`,
    entityType: "ADDRESS",
    accountId,
    addressId: a.id,
    label: a.label,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    region: a.region,
    postalCode: a.postalCode,
    country: a.country,
    hours: a.hours,
    createdAt: now,
    updatedAt: now,
  }));

  const products = seed.products.map((p) => ({
    PK: pk,
    SK: `PROD#${p.id}`,
    entityType: "PRODUCT",
    accountId,
    productId: p.id,
    name: p.name,
    description: p.description,
    kind: p.kind,
    priceMinor: p.priceMinor,
    priceRules: p.priceRules,
    pricingRules: p.pricingRules,
    plans: p.plans,
    currency: p.currency,
    imageUrls: p.imageUrls,
    createdAt: now,
    updatedAt: now,
  }));

  const faqs = seed.faqs.map((f) => ({
    PK: pk,
    SK: `FAQ#${f.id}`,
    entityType: "FAQ",
    accountId,
    faqId: f.id,
    question: f.question,
    answer: f.answer,
    sortOrder: f.sortOrder,
    createdAt: now,
    updatedAt: now,
  }));

  return { profile, phoneLookup, children: [...addresses, ...products, ...faqs] };
}

async function batchPut(
  doc: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    let requestItems = {
      [tableName]: chunk.map((Item) => ({ PutRequest: { Item } })),
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await doc.send(
        new BatchWriteCommand({ RequestItems: requestItems }),
      );
      const unprocessed = result.UnprocessedItems?.[tableName];
      if (!unprocessed?.length) break;
      requestItems = { [tableName]: unprocessed };
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
}

async function upsertDynamo(
  doc: DynamoDBDocumentClient,
  tableName: string,
  accountId: string,
  seed: SeedFile,
  dryRun: boolean,
): Promise<void> {
  const phone = seed.demoUser.phoneE164;
  const now = new Date().toISOString();
  const built = buildItems(accountId, seed, now);
  const keepSk = new Set([
    "PROFILE",
    ...built.children.map((c) => String(c.SK)),
  ]);

  const phoneRow = await doc.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `PHONE#${phone}`, SK: "ACCOUNT" },
    }),
  );
  if (
    phoneRow.Item &&
    phoneRow.Item.accountId &&
    phoneRow.Item.accountId !== accountId
  ) {
    throw new Error(
      `Phone ${phone} is already owned by account ${phoneRow.Item.accountId}`,
    );
  }

  const existingProfile = await doc.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `ACC#${accountId}`, SK: "PROFILE" },
    }),
  );
  const previousPhone =
    typeof existingProfile.Item?.phoneE164 === "string"
      ? existingProfile.Item.phoneE164
      : undefined;

  const existingChildren = await doc.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `ACC#${accountId}` },
    }),
  );
  const stale = (existingChildren.Items ?? []).filter(
    (item) => typeof item.SK === "string" && !keepSk.has(item.SK),
  );

  console.log(
    `Dynamo upsert: 1 profile, 1 phone, ${built.children.length} children` +
      (stale.length ? `, delete ${stale.length} stale` : "") +
      (previousPhone && previousPhone !== phone
        ? `, drop old phone ${previousPhone}`
        : ""),
  );

  if (dryRun) {
    console.log("[dry-run] skipping Dynamo writes");
    return;
  }

  for (const item of stale) {
    await doc.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: item.PK, SK: item.SK },
      }),
    );
  }

  if (previousPhone && previousPhone !== phone) {
    const oldPhone = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `PHONE#${previousPhone}`, SK: "ACCOUNT" },
      }),
    );
    if (oldPhone.Item?.accountId === accountId) {
      await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: `PHONE#${previousPhone}`, SK: "ACCOUNT" },
        }),
      );
    }
  }

  // Preserve createdAt on re-seed when profile already exists.
  if (existingProfile.Item?.createdAt) {
    built.profile.createdAt = String(existingProfile.Item.createdAt);
  }

  await batchPut(doc, tableName, [
    built.profile,
    built.phoneLookup,
    ...built.children,
  ]);
}

async function main(): Promise<void> {
  const { env, profile, region, dryRun } = parseArgs(process.argv.slice(2));
  process.env.AWS_PROFILE = profile;
  process.env.AWS_REGION = region;

  const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) as SeedFile;
  const tableName = `RespondiBe-${env}`;

  console.log(
    `Seeding demo account → env=${env} table=${tableName} profile=${profile} region=${region}` +
      (dryRun ? " (dry-run)" : ""),
  );
  console.log(
    `Credentials: ${seed.demoUser.email} / ${seed.demoUser.phoneE164}`,
  );

  const cognito = new CognitoIdentityProviderClient({ region });
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const userPoolId = await resolveUserPoolId(cognito, env);
  console.log(`User pool: ${userPoolId}`);

  const { accountId } = await ensureCognitoUser(
    cognito,
    userPoolId,
    seed,
    dryRun,
  );
  await upsertDynamo(doc, tableName, accountId, seed, dryRun);

  console.log("Done.");
  console.log(
    JSON.stringify(
      {
        env,
        email: seed.demoUser.email,
        password: seed.demoUser.password,
        phone: seed.demoUser.phoneE164,
        accountId: dryRun ? undefined : accountId,
        tableName,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
