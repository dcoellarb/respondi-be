import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";

export interface WhatsAppWebhookFunctions {
  verify: lambda.IFunction;
  receive: lambda.IFunction;
}

/**
 * Public Meta WhatsApp webhook. Auth is the verify token (GET) and
 * X-Hub-Signature-256 (POST), not Cognito.
 */
export function addWhatsAppWebhookRoutes(
  apiResource: apigateway.Resource,
  functions: WhatsAppWebhookFunctions,
): apigateway.Resource {
  const integrate = (fn: lambda.IFunction) => new apigateway.LambdaIntegration(fn);
  const publicMethod = {
    authorizationType: apigateway.AuthorizationType.NONE,
  };

  const webhooks = apiResource.addResource("webhooks");
  const whatsapp = webhooks.addResource("whatsapp");
  whatsapp.addMethod("GET", integrate(functions.verify), publicMethod);
  whatsapp.addMethod("POST", integrate(functions.receive), publicMethod);
  return whatsapp;
}
