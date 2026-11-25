import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

interface ApiWafProps {
  envName: string;
  restApi: apigateway.RestApi;
  /**
   * Max requests from one IP to the WhatsApp webhook path in a 5-minute window.
   * AWS WAF minimum is 10. Meta retries and bursts need headroom.
   */
  webhookRateLimitPerIp?: number;
}

/**
 * Regional WAF in front of the API stage. Rate-limits the public WhatsApp
 * webhook by source IP so scrapers cannot flood the open route.
 */
export class ApiWaf extends Construct {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: ApiWafProps) {
    super(scope, id);

    const rateLimit = props.webhookRateLimitPerIp ?? 200;
    const metricPrefix = `RespondiBe${props.envName}`;

    this.webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: `RespondiBe-${props.envName}-api`,
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${metricPrefix}WebAcl`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "WhatsAppWebhookIpRateLimit",
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: rateLimit,
              aggregateKeyType: "IP",
              scopeDownStatement: {
                byteMatchStatement: {
                  searchString: "/webhooks/whatsapp",
                  fieldToMatch: { uriPath: {} },
                  textTransformations: [{ priority: 0, type: "LOWERCASE" }],
                  positionalConstraint: "CONTAINS",
                },
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${metricPrefix}WhatsAppWebhookRate`,
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    const stage = props.restApi.deploymentStage;
    new wafv2.CfnWebACLAssociation(this, "WebAclAssociation", {
      resourceArn: stage.stageArn,
      webAclArn: this.webAcl.attrArn,
    });

    new cdk.CfnOutput(this, "WebAclArn", {
      value: this.webAcl.attrArn,
      description: "WAF web ACL protecting the API stage",
    });
  }
}
