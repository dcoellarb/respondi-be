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

// Same account and region as milos-club-be. Stacks stay RespondiBeStack-*,
// so deploys do not update MilosClubBeStack-*.
const account = "725921554236";
const region = "us-east-2";

envsToCreate.forEach((env) => {
  new RespondiBeStack(app, `${stackName}-${env}`, {
    env: { account, region },
    tags: {
      Environment: env,
      Application: "Respondi",
    },
    envName: env,
    stackName: `${stackName}-${env}`,
    description: `Respondi backend (${env})`,
  });
});
