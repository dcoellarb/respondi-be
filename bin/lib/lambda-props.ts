import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { Construct } from "constructs";

export type LambdaBaseProps = Omit<lambda.FunctionProps, "code" | "functionName">;

export interface LambdaPropsContext {
  nodeModulesLayer: lambda.ILayerVersion;
  userPoolId: string;
  clientId: string;
  roles: {
    authCognito: iam.IRole;
    minimal: iam.IRole;
  };
}

export function lambdaCode(relativePath: string): lambda.Code {
  return lambda.Code.fromAsset(
    path.join(__dirname, "../../dist/lambdas", relativePath),
  );
}

export function createFn(
  scope: Construct,
  id: string,
  base: LambdaBaseProps,
  codePath: string,
  extra?: Partial<lambda.FunctionProps>,
): lambda.Function {
  const { environment: extraEnv, ...restExtra } = extra ?? {};
  return new lambda.Function(scope, id, {
    ...base,
    ...restExtra,
    code: lambdaCode(codePath),
    environment: {
      ...base.environment,
      ...extraEnv,
    },
  });
}

/** Amazon Nova Micro US cross-region profile — fast/cheap binary classification. */
export const WHATSAPP_BUSINESS_INTENT_MODEL_ID = "us.amazon.nova-micro-v1:0";

/** Amazon Nova Pro US cross-region profile — reply generation. */
export const WHATSAPP_ANSWER_MODEL_ID = "us.amazon.nova-pro-v1:0";

export function createWebhookLambdaProps(input: {
  role: iam.IRole;
  secretName: string;
  tableName: string;
}): LambdaBaseProps {
  return {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    timeout: cdk.Duration.seconds(5),
    memorySize: 256,
    role: input.role,
    environment: {
      WHATSAPP_WEBHOOK_SECRET_NAME: input.secretName,
      TABLE_NAME: input.tableName,
      BEDROCK_MODEL_ID: WHATSAPP_BUSINESS_INTENT_MODEL_ID,
      BEDROCK_ANSWER_MODEL_ID: WHATSAPP_ANSWER_MODEL_ID,
    },
  };
}

export function createAccountLambdaProps(input: {
  role: iam.IRole;
  tableName: string;
  userPoolId: string;
}): LambdaBaseProps {
  return {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    timeout: cdk.Duration.seconds(10),
    role: input.role,
    environment: {
      TABLE_NAME: input.tableName,
      USER_POOL_ID: input.userPoolId,
    },
  };
}

export function createAuthLambdaProps(ctx: LambdaPropsContext): LambdaBaseProps {
  return {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    timeout: cdk.Duration.seconds(30),
    role: ctx.roles.authCognito,
    environment: {
      USER_POOL_ID: ctx.userPoolId,
      CLIENT_ID: ctx.clientId,
    },
  };
}
