"use client";
import { useEffect, useMemo, useState } from "react";
import { useConfig, useConnection } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkflowSession } from "@/components/workflow-provider";
import { makeProtocolController } from "../workflow-controller";
import type { TransactionLifecycle } from "../transactions";

export function useProtocolTransaction() {
  const config = useConfig();
  const { address, chainId, connector } = useConnection();
  const queryClient = useQueryClient();
  const session = useWorkflowSession();
  const [state, setState] = useState<TransactionLifecycle>({ phase: "idle" });
  const connectorUid = connector?.uid;
  const controller = useMemo(
    () =>
      makeProtocolController(
        config,
        queryClient,
        session,
        setState,
        address,
        chainId,
        connectorUid,
      ),
    [address, chainId, connectorUid, config, queryClient, session],
  );
  useEffect(() => () => controller.reset(), [controller]);
  return {
    ...controller,
    state,
    isBusy: () =>
      controller.isBusy() ||
      (!!address && !!chainId && session.busyActor(chainId, address)),
  };
}
export type ProtocolWriteContext = Parameters<
  Parameters<ReturnType<typeof useProtocolTransaction>["execute"]>[0]
>[0];
