import { z } from "zod";
import { getAddress, isAddress, zeroAddress } from "viem";

export const walletSchema = z
  .string()
  .refine(
    (v) => isAddress(v) && getAddress(v) !== zeroAddress,
    "Invalid wallet address",
  )
  .transform((v) => v.toLowerCase());
export const uint256Schema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/)
  .refine((v) => BigInt(v) <= (1n << 256n) - 1n, "Invalid uint256");
export const hashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v.toLowerCase());
export const nonceSchema = z
  .object({ address: walletSchema, chainId: z.literal(31337) })
  .strict();
export const verifySchema = z
  .object({
    message: z.string().min(1).max(2048),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();
export const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    biography: z.string().trim().max(2000).default(""),
  })
  .strict();
export const scopeSchema = z
  .object({
    chainId: z.literal("31337"),
    escrowAddress: walletSchema,
    deploymentHash: hashSchema,
  })
  .strict();
export type MetadataScope = z.infer<typeof scopeSchema>;
export const projectSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(10000),
    expectedRevision: z.number().int().positive().optional(),
    milestones: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(4),
            name: z.string().trim().min(1).max(160).optional(),
            description: z.string().trim().min(1).max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.milestones.map((m) => m.index)).size === v.milestones.length,
    "Duplicate milestone index",
  );
export type ProjectMetadataInput = z.infer<typeof projectSchema>;
