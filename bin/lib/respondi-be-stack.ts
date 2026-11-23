import * as cdk from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { addAuthRoutes } from "./auth-routes";
import { ApiGateway } from "./api-gateway";
import { CognitoUserPool } from "./cognito-user-pool";
import { createAuthLambdaProps, createFn } from "./lambda-props";
import { LambdaExecutionRoles } from "./lambda-roles";
import { NodeModulesLayer } from "./node-modules-layer";

interface RespondiBeStackProps extends cdk.StackProps {
  envName: string;
  stackName: string;
}

export class RespondiBeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RespondiBeStackProps) {
    super(scope, id, props);

    const userPool = new CognitoUserPool(this, "CognitoUserPool", {
      stackName: props.stackName,
    });

    const socialAuthSecret = new secretsmanager.Secret(this, "SocialAuthHmacSecret", {
      description: "HMAC key for Google custom auth",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 48,
      },
    });

    const nodeModulesLayer = new NodeModulesLayer(this, "NodeModulesLayer", {
      envName: props.envName,
    });

    const roles = new LambdaExecutionRoles(this, "LambdaExecutionRoles", {
      userPoolId: userPool.userPool.userPoolId,
    });

    userPool.attachPreSignUpLambda(roles.minimal, props.stackName);
    userPool.attachCustomAuthLambdas(
      roles.minimal,
      props.stackName,
      socialAuthSecret.secretValue.unsafeUnwrap(),
    );

    const authLambdaProps = createAuthLambdaProps({
      nodeModulesLayer: nodeModulesLayer.layer,
      userPoolId: userPool.userPool.userPoolId,
      clientId: userPool.userPoolClient.userPoolClientId,
      roles: {
        authCognito: roles.authCognito,
        minimal: roles.minimal,
      },
    });

    const signup = createFn(this, "SignupFunction", authLambdaProps, "auth/signup/post");
    const signin = createFn(this, "SigninFunction", authLambdaProps, "auth/signin/post");
    const signout = createFn(this, "SignoutFunction", authLambdaProps, "auth/signout/post");
    const refresh = createFn(
      this,
      "RefreshTokenFunction",
      authLambdaProps,
      "auth/refreshToken/post",
    );
    const forgotPassword = createFn(
      this,
      "ForgotPasswordFunction",
      authLambdaProps,
      "auth/forgotPassword/post",
    );
    const confirmForgotPassword = createFn(
      this,
      "ConfirmForgotPasswordFunction",
      authLambdaProps,
      "auth/confirmForgotPassword/post",
    );
    const social = createFn(this, "SocialSignInFunction", authLambdaProps, "auth/social/post", {
      layers: [nodeModulesLayer.layer],
      environment: {
        ...authLambdaProps.environment,
        SOCIAL_AUTH_SECRET: socialAuthSecret.secretValue.unsafeUnwrap(),
        GOOGLE_CLIENT_IDS: process.env.GOOGLE_CLIENT_IDS || "",
      },
    });

    const api = new ApiGateway(this, "ApiGateway", {
      stackName: props.stackName,
      userPoolId: userPool.userPool.userPoolId,
    });

    addAuthRoutes(api.apiResource, api.authorizer, {
      signup,
      signin,
      social,
      signout,
      refresh,
      forgotPassword,
      confirmForgotPassword,
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.restApi.url,
      description: "API Gateway base URL",
    });
    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPool.userPoolId,
    });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPool.userPoolClient.userPoolClientId,
    });
  }
}
