import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Publish the existing public export, never keys, ABIs or a guessed deployment.
// Missing/invalid exports must not prevent the UI from rendering setup guidance.
const source = new URL(
  "../../../packages/contracts/generated/deployments/31337.json",
  import.meta.url,
);
const target = new URL("../public/deployments/31337.json", import.meta.url);
let data;
try {
  data = JSON.parse(await readFile(source, "utf8"));
} catch {
  data = {
    setupRequired:
      "Deployment export is missing or unreadable. Export a fresh local Phase2D deployment.",
  };
}
await mkdir(fileURLToPath(new URL(".", target)), { recursive: true });
await writeFile(target, `${JSON.stringify(data, null, 2)}\n`);
console.log(
  "Prepared public deployment metadata from packages/contracts (validation occurs before reads).",
);
