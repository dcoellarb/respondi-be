import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface LambdaExecutionRolesProps {
  userPoolId: string;
}

function createBasicLambdaRole(
  scope: Construct,
  id: string,
  description: string,
): iam.Role {
  return new iam.Role(scope, id, {
    assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    description,
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole",
      ),
    ],
  });
}

export class LambdaExecutionRoles extends Construct {
  public readonly authCognito: iam.Role;
  public readonly minimal: iam.Role;
  public readonly accountData: iam.Role;
  public readonly webhook: iam.Role;

  constructor(scope: Construct, id: string, props: LambdaExecutionRolesProps) {
    super(scope, id);

    const userPoolArn = `arn:aws:cognito-idp:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:userpool/${props.userPoolId}`;

    this.authCognito = createBasicLambdaRole(
      this,
      "AuthCognitoLambdaRole",
      "Cognito email and Google auth flows (no VPC)",
    );
    this.authCognito.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:SignUp",
          "cognito-idp:InitiateAuth",
          "cognito-idp:RespondToAuthChallenge",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:ForgotPassword",
          "cognito-idp:ConfirmForgotPassword",
        ],
        resources: [userPoolArn],
      }),
    );
    this.authCognito.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:GetUser", "cognito-idp:GlobalSignOut"],
        resources: ["*"],
      }),
    );

    this.minimal = createBasicLambdaRole(
      this,
      "MinimalLambdaRole",
      "CloudWatch logs only (Cognito triggers)",
    );

    this.accountData = createBasicLambdaRole(
      this,
      "AccountDataLambdaRole",
      "Respondi account profile, catalog, and FAQs",
    );
    this.accountData.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminGetUser"],
        resources: [userPoolArn],
      }),
    );

    this.webhook = createBasicLambdaRole(
      this,
      "WebhookLambdaRole",
      "Public WhatsApp webhook (signature verified in code)",
    );

    // Classifier (Nova Micro) + answer model (Nova Pro) via US inference profiles.
    this.webhook.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockWhatsAppModels",
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:GetInferenceProfile",
        ],
        resources: [
          `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:inference-profile/us.amazon.nova-micro-v1:0`,
          "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0",
          "arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-micro-v1:0",
          "arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-micro-v1:0",
          `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:inference-profile/us.amazon.nova-pro-v1:0`,
          "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0",
          "arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-pro-v1:0",
          "arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-pro-v1:0",
        ],
      }),
    );
  }
}
