import { spawnSync } from "node:child_process";
import { restoreDeploymentAssets } from "./deployment-assets.mjs";
import { prepareStaticFallback } from "./render-static.mjs";

await restoreDeploymentAssets();
const result = spawnSync("bun", ["run", "build"], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await prepareStaticFallback();