import { type Page, type Route } from "@playwright/test";
import {
  accountA,
  accountB,
  blockFixture,
  code,
  fixtureManifest,
  rpcFixture,
} from "../test-support/protocol";

declare global {
  interface Window {
    __testWallet: {
      account: (address: string) => void;
      chain: (chain: number) => void;
      disconnect: () => void;
      calls: string[];
    };
  }
}
export { accountA, accountB };
export async function installWallet(
  page: Page,
  options: {
    chainId?: number;
    rejected?: boolean;
    unknownNetwork?: boolean;
    switchRejected?: boolean;
    walletWrongBlock?: boolean;
  } = {},
) {
  const manifest = fixtureManifest();
  await page.addInitScript(
    ({ accountA, options, block, code }) => {
      let accounts: string[] = [accountA];
      let chainId = options.chainId ?? 31337;
      let authorized = false;
      let known = !options.unknownNetwork;
      const calls: string[] = [];
      const listeners = new Map<string, Set<(value: unknown) => void>>();
      const emit = (event: string, value: unknown) =>
        listeners.get(event)?.forEach((listener) => listener(value));
      const provider = {
        isMetaMask: true,
        on(event: string, listener: (value: unknown) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(listener);
        },
        removeListener(event: string, listener: (value: unknown) => void) {
          listeners.get(event)?.delete(listener);
        },
        async request({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }) {
          calls.push(method);
          if (
            method === "wallet_requestPermissions" ||
            method === "eth_requestAccounts"
          ) {
            if (options.rejected)
              throw { code: 4001, message: "User rejected request" };
            authorized = true;
            return method === "eth_requestAccounts"
              ? accounts
              : [
                  {
                    parentCapability: "eth_accounts",
                    caveats: [
                      { type: "restrictReturnedAccounts", value: accounts },
                    ],
                  },
                ];
          }
          if (method === "eth_accounts") return authorized ? accounts : [];
          if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
          if (method === "wallet_switchEthereumChain") {
            if (options.switchRejected)
              throw { code: 4001, message: "User rejected network switch" };
            if (!known) throw { code: 4902, message: "Unknown chain" };
            chainId = Number((params?.[0] as { chainId: string }).chainId);
            emit("chainChanged", `0x${chainId.toString(16)}`);
            return null;
          }
          if (method === "wallet_addEthereumChain") {
            known = true;
            chainId = Number((params?.[0] as { chainId: string }).chainId);
            emit("chainChanged", `0x${chainId.toString(16)}`);
            return null;
          }
          if (method === "wallet_revokePermissions") {
            authorized = false;
            return null;
          }
          if (method === "eth_getBlockByNumber")
            return options.walletWrongBlock
              ? { ...block, hash: `0x${"f".repeat(64)}` }
              : block;
          if (method === "eth_getCode") return code;
          throw {
            code: -32601,
            message: `Unsupported fixture method ${method}`,
          };
        },
      };
      Object.defineProperty(window, "ethereum", {
        value: provider,
        configurable: true,
      });
      window.__testWallet = {
        calls,
        account(address) {
          accounts = [address];
          emit("accountsChanged", accounts);
        },
        chain(chain) {
          chainId = chain;
          emit("chainChanged", `0x${chain.toString(16)}`);
        },
        disconnect() {
          accounts = [];
          authorized = false;
          emit("accountsChanged", []);
        },
      };
    },
    { accountA, options, block: blockFixture(manifest), code },
  );
}
export async function installRpc(
  page: Page,
  options: {
    missing?: boolean;
    invalid?: boolean;
    ephemeral?: boolean;
    unavailable?: boolean;
    decimals?: number;
    rpcWrongBlock?: boolean;
    readFailure?: boolean;
  } = {},
) {
  const manifest = fixtureManifest();
  await page.route("**/deployments/31337.json", (route) =>
    route.fulfill({
      status: options.missing ? 404 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.invalid
          ? {}
          : { ...manifest, ephemeral: options.ephemeral ?? false },
      ),
    }),
  );
  await page.route("http://127.0.0.1:8545/**", async (route: Route) => {
    if (options.unavailable) {
      await route.abort("connectionrefused");
      return;
    }
    const payload = route.request().postDataJSON() as
      | { id: number; method: string; params: unknown[] }
      | { id: number; method: string; params: unknown[] }[];
    const answer = (request: {
      id: number;
      method: string;
      params: unknown[];
    }) => {
      if (options.readFailure && request.method === "eth_call")
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: "Read failed" },
        };
      return {
        jsonrpc: "2.0",
        id: request.id,
        result:
          options.rpcWrongBlock && request.method === "eth_getBlockByNumber"
            ? { ...blockFixture(manifest), hash: `0x${"f".repeat(64)}` }
            : rpcFixture(
                request.method,
                request.params ?? [],
                manifest,
                options.decimals,
              ),
      };
    };
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
      },
      contentType: "application/json",
      body: JSON.stringify(
        Array.isArray(payload) ? payload.map(answer) : answer(payload),
      ),
    });
  });
}
export async function connectWallet(page: Page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog", { name: "Wallet connection", exact: true })
    .getByRole("button", { name: "Connect Injected", exact: true })
    .click();
}
