import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { Construct } from "constructs";

interface NodeModulesLayerProps {
  envName: string;
}

/**
 * Shared layer for npm libraries that are not part of the Lambda runtime.
 * Built by scripts/build-node-modules-layer.js into dist/layers/node-modules.
 */
export class NodeModulesLayer extends Construct {
  public readonly layer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, props: NodeModulesLayerProps) {
    super(scope, id);

    this.layer = new lambda.LayerVersion(this, "NodeModulesLayerVersion", {
      layerVersionName: `respondi-${props.envName}-node-modules`,
      description: "Extra Node libraries for Respondi Lambdas (jose)",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../dist/layers/node-modules"),
      ),
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
