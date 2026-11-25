import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { UserPool } from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

interface ApiGatewayProps {
  stackName: string;
  userPoolId: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "'*'",
  "Access-Control-Allow-Headers": "'Content-Type,Authorization'",
};

export class ApiGateway extends Construct {
  public readonly restApi: apigateway.RestApi;
  public readonly apiResource: apigateway.Resource;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    this.restApi = new apigateway.RestApi(this, "Api", {
      restApiName: `${props.stackName}-Api`,
      description: "HTTP API for Respondi",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization", "X-Hub-Signature-256"],
      },
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        methodOptions: {
          "/api/webhooks/whatsapp/GET": {
            throttlingRateLimit: 10,
            throttlingBurstLimit: 20,
          },
          "/api/webhooks/whatsapp/POST": {
            throttlingRateLimit: 25,
            throttlingBurstLimit: 50,
          },
        },
      },
    });

    const userPool = UserPool.fromUserPoolId(this, "UserPool", props.userPoolId);
    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      { cognitoUserPools: [userPool] },
    );
    this.authorizer._attachToApi(this.restApi);

    this.restApi.addGatewayResponse("Default4xx", {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: corsHeaders,
    });
    this.restApi.addGatewayResponse("Default5xx", {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: corsHeaders,
    });

    this.apiResource = this.restApi.root.addResource("api");

    this.restApi.root.addMethod(
      "GET",
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": "'*'",
            },
            responseTemplates: {
              "application/json": '{"data":{"service":"respondi"}}',
            },
          },
        ],
        requestTemplates: { "application/json": '{"statusCode": 200}' },
      }),
      {
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
        ],
        authorizationType: apigateway.AuthorizationType.NONE,
      },
    );
  }
}
