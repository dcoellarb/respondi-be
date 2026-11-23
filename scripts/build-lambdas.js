#!/usr/bin/env node

/**
 * Compiles src/lambdas with tsc, then packages each handler folder under
 * dist/lambdas/<path>/index.js. Shared code in src/lambdas/utils is copied
 * into any handler that imports it, and those require() paths are rewritten
 * to ./utils so the zip is self-contained.
 *
 * Extra npm libraries are not copied here. They belong in the node-modules
 * layer (scripts/build-node-modules-layer.js). @aws-sdk/* stays external
 * because the Node.js 22 Lambda runtime provides it.
 */

const fs = require("fs-extra");
const path = require("path");
const { execSync } = require("child_process");

const DIST_LAMBDAS_DIR = "dist/lambdas";
const SRC_DIR = "src/lambdas";

function findLambdaFolders() {
  const lambdaFolders = [];

  function scanDirectory(dir, relativePath = "") {
    for (const item of fs.readdirSync(dir)) {
      if (item === "types") continue;
      if (item === "utils" && relativePath === "") continue;

      const fullPath = path.join(dir, item);
      if (!fs.statSync(fullPath).isDirectory()) continue;

      const newRelativePath = relativePath ? `${relativePath}/${item}` : item;
      if (fs.existsSync(path.join(fullPath, "index.ts"))) {
        lambdaFolders.push({
          name: newRelativePath,
          srcPath: fullPath,
          distPath: path.join(DIST_LAMBDAS_DIR, newRelativePath),
        });
      } else {
        scanDirectory(fullPath, newRelativePath);
      }
    }
  }

  scanDirectory(SRC_DIR);
  return lambdaFolders;
}

function updateImportPaths(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  const updated = content
    .replace(/require\((["'])((?:\.\.\/)+)utils\//g, "require($1./utils/")
    .replace(/from (["'])((?:\.\.\/)+)utils\//g, "from $1./utils/");

  if (updated !== content) {
    fs.writeFileSync(filePath, updated);
    console.log(`   Rewrote utils imports in ${path.basename(filePath)}`);
  }
}

function copyUtilsIfNeeded(lambdaDistPath) {
  const indexJsPath = path.join(lambdaDistPath, "index.js");
  if (!fs.existsSync(indexJsPath)) return;

  const content = fs.readFileSync(indexJsPath, "utf8");
  if (!/(\.\.\/)+utils/.test(content)) return;

  const srcUtilsPath = path.join(DIST_LAMBDAS_DIR, "utils");
  if (!fs.existsSync(srcUtilsPath)) {
    throw new Error(
      `Handler imports utils but ${srcUtilsPath} was not compiled`,
    );
  }

  fs.copySync(srcUtilsPath, path.join(lambdaDistPath, "utils"));
  updateImportPaths(indexJsPath);
  console.log(`   Copied utils into ${path.relative(DIST_LAMBDAS_DIR, lambdaDistPath)}`);
}

function buildLambdas() {
  console.log("Compiling Lambda TypeScript...");
  execSync("npx tsc --project tsconfig.lambda.json", { stdio: "inherit" });

  const lambdaFolders = findLambdaFolders();
  console.log(`Packaging ${lambdaFolders.length} Lambda functions`);

  for (const lambda of lambdaFolders) {
    const indexJsPath = path.join(lambda.distPath, "index.js");
    if (!fs.existsSync(indexJsPath)) {
      throw new Error(`Compiled handler missing: ${indexJsPath}`);
    }
    copyUtilsIfNeeded(lambda.distPath);
    console.log(`   ${lambda.name}`);
  }

  const distUtilsPath = path.join(DIST_LAMBDAS_DIR, "utils");
  if (fs.existsSync(distUtilsPath)) {
    fs.removeSync(distUtilsPath);
  }

  const distTypesPath = path.join(DIST_LAMBDAS_DIR, "types");
  if (fs.existsSync(distTypesPath)) {
    fs.removeSync(distTypesPath);
  }

  console.log("Lambda build finished");
}

if (require.main === module) {
  buildLambdas();
}

module.exports = { buildLambdas };
