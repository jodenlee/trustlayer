/** UI view models, not raw contract structs. All token quantities use six-decimal base units. */
export type MilestoneState = "Pending" | "Submitted" | "Approved" | "Disputed";
export type ProjectState = "Active" | "Awaiting acceptance" | "Completed";
export interface Milestone {
  title: string;
  amount: bigint;
  state: MilestoneState;
  due: string;
}
export interface Project {
  id: string;
  title: string;
  category: string;
  client: string;
  freelancer: string;
  role: "Client" | "Freelancer";
  state: ProjectState;
  escrowed: bigint;
  description: string;
  milestones: Milestone[];
}
export interface Dispute {
  id: string;
  projectId: string;
  milestoneIndex: number;
  state: "Response window" | "Voting open";
  openedAt: string;
  responseDeadline: string;
  votingDeadline: string;
  reason: string;
}
export type TransactionState = "Pending" | "Confirmed" | "Failed";
export interface TransactionView {
  hash: `0x${string}`;
  type: string;
  state: TransactionState;
  amount: bigint;
  timestamp: string;
}
