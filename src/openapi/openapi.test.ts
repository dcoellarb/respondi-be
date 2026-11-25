import { execSync } from "child_process";
import * as path from "path";

describe("openapi.json", () => {
  it("matches the handler annotations", () => {
    execSync("npx ts-node --transpile-only scripts/openapi-generator.ts --check", {
      cwd: path.join(__dirname, "../.."),
      stdio: "pipe",
    });
  });
});
