import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

/**
 * Single-table store for one Respondi account: profile, phone lookup,
 * addresses, products, FAQs, and short-lived WhatsApp conversations.
 * The table name is RespondiBe-{env}, separate from every MilosClub table.
 */
export class AccountTable extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, envName: string) {
    super(scope, id);

    const isProduction = envName === "production";
    this.table = new dynamodb.Table(this, "Table", {
      tableName: `RespondiBe-${envName}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      deletionProtection: isProduction,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProduction,
      },
      // WhatsApp conversations set expiresAt (epoch seconds) = createdAt + 1 hour.
      timeToLiveAttribute: "expiresAt",
    });
  }
}
