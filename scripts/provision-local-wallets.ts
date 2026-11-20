// Opt-in ETH + mUSD targets; five explicit recipient variables remain mandatory.
process.env.TRUSTLAYER_PROVISION_NATIVE = "true";
await import("./provision-local-tokens.js");
