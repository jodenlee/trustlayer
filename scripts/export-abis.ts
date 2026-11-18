import { fileURLToPath } from "node:url";
import { exportAbis } from "./lib/artifacts.js";

await exportAbis(fileURLToPath(new URL("../", import.meta.url)));
console.log("Exported five production ABIs, typed constants and the function/event inventory.");
