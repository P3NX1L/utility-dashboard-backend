import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Fixed allowlist: a text-only source export must not write arbitrary paths.
export const assetPaths = ["public/favicon.png", "src/assets/five-day-heading.png"];
export async function restoreDeploymentAssets(root = process.cwd()) {
  const assets = JSON.parse(await readFile(resolve(root, "deployment-assets.json"), "utf8"));
  for (const path of assetPaths) {
    const encoded = assets[path];
    if (typeof encoded !== "string") throw new Error(`Missing deployment asset: ${path}`);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error(`Invalid PNG encoding: ${path}`);
    }
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}