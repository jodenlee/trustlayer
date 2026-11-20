// Shared non-secret wire types. All authorization/hashing is repeated server-side.
export type FileCategory = "deliverable" | "opening" | "response" | "evidence";
export interface FileRecord {
  id: string;
  category: FileCategory;
  filename: string;
  media_type: string;
  byte_size: number;
  content_hash: string;
  status: string;
  uploader: string;
  project_id: string;
  milestone_index: number;
  dispute_id: string | null;
  transaction_hash: string | null;
  created_at: string;
}
export interface PersistentProject {
  id: string;
  title: string;
  description: string;
  revision: number;
  milestones: { onchain_index: number; name: string; description: string }[];
}
export const FILE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
] as const;
