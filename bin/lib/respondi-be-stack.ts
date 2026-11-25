import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { AccountTable } from "./account-table";
import { addAccountRoutes } from "./account-routes";
import { addAuthRoutes } from "./auth-routes";
import { ApiGateway } from "./api-gateway";
import { ApiWaf } from "./api-waf";
import { CognitoUserPool } from "./cognito-user-pool";
import {
  createAccountLambdaProps,
  createAuthLambdaProps,
  createFn,
  createWebhookLambdaProps,
} from "./lambda-props";
import { LambdaExecutionRoles } from "./lambda-roles";
import { NodeModulesLayer } from "./node-modules-layer";
import { addSwaggerRoutes } from "./swagger-routes";
import { WhatsAppWebhookSecret } from "./whatsapp-webhook-secret";
import { addWhatsAppWebhookRoutes } from "./whatsapp-webhook-routes";

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

    const accountTable = new AccountTable(this, "AccountTable", props.envName);

    const roles = new LambdaExecutionRoles(this, "LambdaExecutionRoles", {
      userPoolId: userPool.userPool.userPoolId,
    });
    accountTable.table.grantReadWriteData(roles.accountData);
    // WhatsApp receive reads account data and read/writes short-lived conversations.
    accountTable.table.grantReadWriteData(roles.webhook);

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

    const accountLambdaProps = createAccountLambdaProps({
      role: roles.accountData,
      tableName: accountTable.table.tableName,
      userPoolId: userPool.userPool.userPoolId,
    });
    const accountFn = (id: string, codePath: string) =>
      createFn(this, id, accountLambdaProps, codePath);

    const whatsappWebhookSecret = new WhatsAppWebhookSecret(
      this,
      "WhatsAppWebhookSecret",
      props.stackName,
    );
    whatsappWebhookSecret.secret.grantRead(roles.webhook);

    const connectWhatsApp = createFn(
      this,
      "WhatsAppConnectFunction",
      {
        ...accountLambdaProps,
        timeout: cdk.Duration.seconds(30),
        environment: {
          ...accountLambdaProps.environment,
          WHATSAPP_WEBHOOK_SECRET_NAME: whatsappWebhookSecret.secret.secretName,
        },
      },
      "account/whatsapp/post",
    );
    whatsappWebhookSecret.secret.grantRead(connectWhatsApp);

    addAccountRoutes(api.apiResource, api.authorizer, {
      getAccount: accountFn("AccountGetFunction", "account/get"),
      putAccount: accountFn("AccountPutFunction", "account/put"),
      patchAccount: accountFn("AccountPatchFunction", "account/patch"),
      listAddresses: accountFn("AddressListFunction", "account/addresses/get"),
      createAddress: accountFn("AddressCreateFunction", "account/addresses/post"),
      getAddress: accountFn("AddressGetFunction", "account/addresses/addressId/get"),
      putAddress: accountFn("AddressPutFunction", "account/addresses/addressId/put"),
      patchAddress: accountFn("AddressPatchFunction", "account/addresses/addressId/patch"),
      deleteAddress: accountFn("AddressDeleteFunction", "account/addresses/addressId/delete"),
      listProducts: accountFn("ProductListFunction", "account/products/get"),
      createProduct: accountFn("ProductCreateFunction", "account/products/post"),
      getProduct: accountFn("ProductGetFunction", "account/products/productId/get"),
      putProduct: accountFn("ProductPutFunction", "account/products/productId/put"),
      patchProduct: accountFn("ProductPatchFunction", "account/products/productId/patch"),
      deleteProduct: accountFn("ProductDeleteFunction", "account/products/productId/delete"),
      listFaqs: accountFn("FaqListFunction", "account/faqs/get"),
      createFaq: accountFn("FaqCreateFunction", "account/faqs/post"),
      getFaq: accountFn("FaqGetFunction", "account/faqs/faqId/get"),
      putFaq: accountFn("FaqPutFunction", "account/faqs/faqId/put"),
      patchFaq: accountFn("FaqPatchFunction", "account/faqs/faqId/patch"),
      deleteFaq: accountFn("FaqDeleteFunction", "account/faqs/faqId/delete"),
      getWhatsApp: accountFn("WhatsAppGetFunction", "account/whatsapp/get"),
      connectWhatsApp,
      disconnectWhatsApp: accountFn(
        "WhatsAppDisconnectFunction",
        "account/whatsapp/delete",
      ),
    });

    const webhookLambdaProps = createWebhookLambdaProps({
      role: roles.webhook,
      secretName: whatsappWebhookSecret.secret.secretName,
      tableName: accountTable.table.tableName,
    });
    addWhatsAppWebhookRoutes(api.apiResource, {
      verify: createFn(
        this,
        "WhatsAppWebhookVerifyFunction",
        webhookLambdaProps,
        "webhooks/whatsapp/get",
      ),
      receive: createFn(
        this,
        "WhatsAppWebhookReceiveFunction",
        {
          ...webhookLambdaProps,
          // Classifier + Nova Pro reply generation need more headroom.
          timeout: cdk.Duration.seconds(45),
          memorySize: 512,
        },
        "webhooks/whatsapp/post",
      ),
    });

    addSwaggerRoutes(
      api.apiResource,
      createFn(
        this,
        "SwaggerFunction",
        {
          runtime: lambda.Runtime.NODEJS_22_X,
          handler: "index.handler",
          timeout: cdk.Duration.seconds(10),
          role: roles.minimal,
        },
        "ops/swagger/get",
      ),
    );

    new ApiWaf(this, "ApiWaf", {
      envName: props.envName,
      restApi: api.restApi,
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.restApi.url,
      description: "API Gateway base URL",
    });
    new cdk.CfnOutput(this, "SwaggerUrl", {
      value: `${api.restApi.url}api/swagger`,
      description: "Swagger UI",
    });
    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPool.userPoolId,
    });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPool.userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "AccountTableName", {
      value: accountTable.table.tableName,
      description: "DynamoDB single table for account data",
    });
    new cdk.CfnOutput(this, "WhatsAppWebhookUrl", {
      value: `${api.restApi.url}api/webhooks/whatsapp`,
      description: "Meta WhatsApp webhook callback URL",
    });
    new cdk.CfnOutput(this, "WhatsAppWebhookSecretName", {
      value: whatsappWebhookSecret.secret.secretName,
      description:
        "Secrets Manager name for WhatsApp verifyToken and appSecret. Update those keys in the console.",
    });
  }
}
