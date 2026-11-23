#!/usr/bin/env node

/**
 * Builds the shared Lambda layer for libraries that are not in the Node.js 22
 * runtime. Add a package name to LAYER_PACKAGES and to package.json dependencies,
 * then attach the layer on the Lambda that imports it.
 *
 * Layout matches AWS Lambda: dist/layers/node-modules/nodejs/node_modules
 */

const { execSync } = require("child_process");
const fs = require("fs-extra");
const path = require("path");

const LAYER_PACKAGES = ["jose"];

const ROOT_DIR = process.cwd();
const LAYER_DIR = path.join(ROOT_DIR, "dist/layers/node-modules");
const NODEJS_DIR = path.join(LAYER_DIR, "nodejs");

async function buildNodeModulesLayer() {
  console.log("Building node-modules Lambda layer...");

  const rootPackage = await fs.readJSON(path.join(ROOT_DIR, "package.json"));
  const dependencies = {};

  for (const name of LAYER_PACKAGES) {
    const version = rootPackage.dependencies?.[name];
    if (!version) {
      console.error(`Missing "${name}" in package.json dependencies.`);
      process.exit(1);
    }
    dependencies[name] = version;
  }

  await fs.remove(LAYER_DIR);
  await fs.ensureDir(NODEJS_DIR);
  await fs.writeJSON(
    path.join(NODEJS_DIR, "package.json"),
    {
      name: "respondi-node-modules-layer",
      version: "1.0.0",
      dependencies,
    },
    { spaces: 2 },
  );

  console.log(`Installing ${LAYER_PACKAGES.join(", ")} into the layer...`);
  execSync("npm install --omit=dev", {
    cwd: NODEJS_DIR,
    stdio: "inherit",
  });

  console.log(`Layer ready at ${LAYER_DIR}`);
}

buildNodeModulesLayer().catch((error) => {
  console.error("Failed to build node-modules layer:", error.message);
  process.exit(1);
});
