import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import phase1 from "./Phase1.js";

export default buildModule("TrustLayerPhase2B", (m) => {
  const { token, escrow } = m.useModule(phase1);
  const registry = m.contract("JurorRegistry", [token]);
  // Production arbitration does not exist yet. Leave escrow and registry unconfigured.
  return { token, escrow, registry };
});
