// @vitest-environment node
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Build helpers are plain JS so text-only exports need no extra runtime packages.
const loadHelpers = () => import("../../scripts/deployment-assets.mjs");
const loadFallback = () => import("../../scripts/render-static.mjs");
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tenant-deployment-"));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("text-only deployment", () => {
  it("encodes both original PNGs exactly and restores identical bytes", async () => {
    const root = await fixture();
    const manifest = await readFile("deployment-assets.json", "utf8");
    const assets = JSON.parse(manifest) as Record<string, string>;
    expect(Object.keys(assets).sort()).toEqual(["public/favicon.png", "src/assets/five-day-heading.png"]);
    await writeFile(join(root, "deployment-assets.json"), manifest);
    const { restoreDeploymentAssets, assetPaths } = await loadHelpers();
    await restoreDeploymentAssets(root);
    for (const path of assetPaths) {
      expect(Buffer.from(assets[path] ?? "", "base64")).toEqual(await readFile(path));
      expect(await readFile(join(root, path))).toEqual(await readFile(path));
    }
  });
  it("creates an identical 404 fallback without changing index or route output", async () => {
    const root = await fixture();
    await mkdir(join(root, "dist/client/five-day"), { recursive: true });
    await writeFile(join(root, "dist/client/index.html"), "synthetic index");
    await writeFile(join(root, "dist/client/five-day/index.html"), "synthetic notice route");
    await (await loadFallback()).prepareStaticFallback(root);
    expect(await readFile(join(root, "dist/client/404.html"), "utf8")).toBe("synthetic index");
    expect(await readFile(join(root, "dist/client/index.html"), "utf8")).toBe("synthetic index");
    expect(await readFile(join(root, "dist/client/five-day/index.html"), "utf8")).toBe("synthetic notice route");
  });
});