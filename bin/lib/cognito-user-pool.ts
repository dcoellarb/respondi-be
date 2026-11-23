import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { Construct } from "constructs";

interface CognitoUserPoolProps {
  stackName: string;
}

/**
 * User pool for Respondi store owners.
 * Email/password uses the public SignUp and USER_PASSWORD_AUTH flows.
 * Google uses a custom auth challenge: the API verifies the Google ID token,
 * then Cognito issues its own tokens after the verify trigger checks an HMAC.
 * Provider identity is stored on the Cognito user until a database exists.
 */
export class CognitoUserPool extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: CognitoUserPoolProps) {
    super(scope, id);

    const userPoolName = `${props.stackName}-userpool`;

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      standardAttributes: {
        email: { required: true, mutable: false },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        authProvider: new cognito.StringAttribute({
          minLen: 1,
          maxLen: 16,
          mutable: true,
        }),
        providerSubject: new cognito.StringAttribute({
          minLen: 1,
          maxLen: 255,
          mutable: true,
        }),
      },
    });

    const readableAttributes = new cognito.ClientAttributes()
      .withStandardAttributes({
        email: true,
        emailVerified: true,
        givenName: true,
        familyName: true,
      })
      .withCustomAttributes("authProvider", "providerSubject");

    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPoolClientName: `${userPoolName}-client`,
      userPool: this.userPool,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
      },
      preventUserExistenceErrors: false,
      accessTokenValidity: cdk.Duration.hours(24),
      idTokenValidity: cdk.Duration.hours(24),
      refreshTokenValidity: cdk.Duration.days(365),
      readAttributes: readableAttributes,
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        givenName: true,
        familyName: true,
      }),
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });
  }

  attachPreSignUpLambda(minimalLambdaRole: iam.IRole, stackName: string): void {
    const preSignUpLambda = new lambda.Function(this, "PreSignUpLambda", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      role: minimalLambdaRole,
      functionName: `${stackName}-PreSignupFunction`,
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../dist/lambdas/auth/preSignUp"),
      ),
    });
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_SIGN_UP,
      preSignUpLambda,
    );
  }

  attachCustomAuthLambdas(
    minimalLambdaRole: iam.IRole,
    stackName: string,
    socialAuthSecret: string,
  ): void {
    const common = {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      role: minimalLambdaRole,
    };

    const defineAuthChallenge = new lambda.Function(
      this,
      "DefineAuthChallengeLambda",
      {
        ...common,
        functionName: `${stackName}-SocialDefineAuth`,
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../dist/lambdas/auth/customAuth/define"),
        ),
      },
    );
    const createAuthChallenge = new lambda.Function(
      this,
      "CreateAuthChallengeLambda",
      {
        ...common,
        functionName: `${stackName}-SocialCreateAuth`,
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../dist/lambdas/auth/customAuth/create"),
        ),
      },
    );
    const verifyAuthChallenge = new lambda.Function(
      this,
      "VerifyAuthChallengeLambda",
      {
        ...common,
        functionName: `${stackName}-SocialVerifyAuth`,
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../dist/lambdas/auth/customAuth/verify"),
        ),
        environment: {
          SOCIAL_AUTH_SECRET: socialAuthSecret,
        },
      },
    );

    this.userPool.addTrigger(
      cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE,
      defineAuthChallenge,
    );
    this.userPool.addTrigger(
      cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE,
      createAuthChallenge,
    );
    this.userPool.addTrigger(
      cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE,
      verifyAuthChallenge,
    );
  }
}
