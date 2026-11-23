#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as dotenv from "dotenv";
import { RespondiBeStack } from "./lib/respondi-be-stack";

dotenv.config();

const stackName = "RespondiBeStack";
const app = new cdk.App();

const environments = ["development", "staging", "production"] as const;
type EnvName = (typeof environments)[number];

const envContext = app.node.tryGetContext("env") as string | undefined;
if (envContext && !environments.includes(envContext as EnvName)) {
  throw new Error(
    `Unknown env context "${envContext}". Expected one of: ${environments.join(", ")}`,
  );
}

const envsToCreate: readonly EnvName[] = envContext
  ? [envContext as EnvName]
  : environments;

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || "us-east-2";

envsToCreate.forEach((env) => {
  new RespondiBeStack(app, `${stackName}-${env}`, {
    env: account ? { account, region } : undefined,
    tags: {
      Environment: env,
      Application: "Respondi",
    },
    envName: env,
    stackName: `${stackName}-${env}`,
    description: `Respondi backend (${env})`,
  });
});
