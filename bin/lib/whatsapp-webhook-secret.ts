import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

/**
 * Meta WhatsApp webhook credentials for one environment.
 * Name follows stack resources: RespondiBeStack-{env}-whatsapp-webhook.
 * Initial JSON uses REPLACE_ME placeholders; update values in the AWS console.
 */
export class WhatsAppWebhookSecret extends Construct {
  public readonly secret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, stackName: string) {
    super(scope, id);

    this.secret = new secretsmanager.Secret(this, "Secret", {
      secretName: `${stackName}-whatsapp-webhook`,
      description:
        "WhatsApp Cloud API. Set verifyToken, appSecret, appId (Embedded Signup), and optional env accessToken in the console.",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          verifyToken: "REPLACE_ME",
          appSecret: "REPLACE_ME",
          appId: "REPLACE_ME",
          accessToken: "REPLACE_ME",
        }),
        generateStringKey: "generatedNonce",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
  }
}
