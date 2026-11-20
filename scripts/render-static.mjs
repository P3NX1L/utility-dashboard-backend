import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function prepareStaticFallback(root = process.cwd()) {
  const output = resolve(root, "dist/client");
  // The prerendered index bootstraps the existing router, including its 404 view.
  await copyFile(resolve(output, "index.html"), resolve(output, "404.html"));
}