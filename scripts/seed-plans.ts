import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const PLANS = [
  {
    name: "basic",
    subtitle: "500 mensajes",
    messagesCap: 500,
    addressesCap: 1,
    servicesCap: 10,
    productsCap: 0,
    faqsCap: 10,
    price: 9.99,
    frequency: "monthly",
  },
  {
    name: "basic",
    subtitle: "500 mensajes",
    messagesCap: 500,
    addressesCap: 1,
    servicesCap: 10,
    productsCap: 0,
    faqsCap: 10,
    price: 99.99,
    frequency: "annual",
  },
  {
    name: "pro",
    subtitle: "1000 mensajes",
    messagesCap: 1000,
    addressesCap: 0,
    servicesCap: 20,
    productsCap: 20,
    faqsCap: 20,
    price: 19.99,
    frequency: "monthly",
  },
  {
    name: "pro",
    subtitle: "1000 mensajes",
    messagesCap: 1000,
    addressesCap: 0,
    servicesCap: 20,
    productsCap: 20,
    faqsCap: 20,
    price: 199.99,
    frequency: "annual",
  },
  {
    name: "gold",
    subtitle: "Pro + 50 productos",
    messagesCap: 1000,
    addressesCap: 0,
    servicesCap: 20,
    productsCap: 50,
    faqsCap: 20,
    price: 29.99,
    frequency: "monthly",
  },
  {
    name: "gold",
    subtitle: "Pro + 50 productos",
    messagesCap: 1000,
    addressesCap: 0,
    servicesCap: 20,
    productsCap: 50,
    faqsCap: 20,
    price: 299.99,
    frequency: "annual",
  },
];

async function main() {
  const env = process.argv[2];
  if (!env) {
    console.error(
      "Usage: npx ts-node scripts/seed-plans.ts <development|staging|production>",
    );
    process.exit(1);
  }
  const tableName = `RespondiBe-${env}`;
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: "us-east-2" }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: "PLANS",
        SK: "PLANS",
        entityType: "PLANS",
        plans: PLANS,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
  console.log(`Seeded ${PLANS.length} plans into ${tableName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
