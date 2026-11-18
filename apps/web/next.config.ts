import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  transpilePackages: ["@trustlayer/contracts"],
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
    // Keep the SDK's NodeNext .js specifiers intact for Hardhat/tsx consumers.
    resolveAlias: {
      "../generated/abis.js": "../../packages/contracts/generated/abis.ts",
      "./names.js": "../../packages/contracts/src/names.ts",
    },
  },
  poweredByHeader: false,
};
export default config;
