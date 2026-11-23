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
