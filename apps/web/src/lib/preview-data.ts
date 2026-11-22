import type { Dispute, Project } from "./models";
const usd = (value: number) => BigInt(value) * 1_000_000n;
/** Fictional UI fixtures. Never feed these IDs, states or balances into contract calls. */
export const projects: Project[] = [
  {
    id: "tl-1042",
    title: "Brand & website refresh",
    category: "Design & development",
    client: "Northstar Studio",
    freelancer: "Alex Morgan",
    role: "Client",
    state: "Active",
    escrowed: usd(1800),
    description:
      "A refreshed visual identity and a thoughtful new home for the studio.",
    milestones: [
      {
        title: "Discovery & direction",
        amount: usd(600),
        state: "Approved",
        due: "2026-11-10",
      },
      {
        title: "Design system",
        amount: usd(900),
        state: "Submitted",
        due: "2026-11-20",
      },
      {
        title: "Website handoff",
        amount: usd(900),
        state: "Pending",
        due: "2026-12-04",
      },
    ],
  },
  {
    id: "tl-1043",
    title: "Product launch illustrations",
    category: "Illustration",
    client: "Fieldwork",
    freelancer: "Alex Morgan",
    role: "Freelancer",
    state: "Active",
    escrowed: usd(800),
    description: "An illustration series for a new product launch.",
    milestones: [
      {
        title: "Concept exploration",
        amount: usd(400),
        state: "Approved",
        due: "2026-11-08",
      },
      {
        title: "Illustration set",
        amount: usd(600),
        state: "Disputed",
        due: "2026-11-18",
      },
      {
        title: "Final delivery",
        amount: usd(200),
        state: "Pending",
        due: "2026-12-01",
      },
    ],
  },
  {
    id: "tl-1044",
    title: "Analytics dashboard UI",
    category: "Product design",
    client: "Northstar Studio",
    freelancer: "Jamie Chen",
    role: "Client",
    state: "Active",
    escrowed: usd(1800),
    description:
      "A clearer view of product analytics, from prototype to component library.",
    milestones: [
      {
        title: "Interactive prototype",
        amount: usd(600),
        state: "Disputed",
        due: "2026-11-18",
      },
      {
        title: "Component library",
        amount: usd(800),
        state: "Pending",
        due: "2026-12-02",
      },
      {
        title: "Design handoff",
        amount: usd(400),
        state: "Pending",
        due: "2026-12-09",
      },
    ],
  },
  {
    id: "tl-1045",
    title: "Mobile onboarding flow",
    category: "Experience design",
    client: "Northstar Studio",
    freelancer: "Sam Rivera",
    role: "Client",
    state: "Awaiting acceptance",
    escrowed: usd(950),
    description: "A welcoming first experience for a mobile application.",
    milestones: [
      {
        title: "Wireframes",
        amount: usd(350),
        state: "Pending",
        due: "2026-12-08",
      },
      {
        title: "Interface design",
        amount: usd(600),
        state: "Pending",
        due: "2026-12-18",
      },
    ],
  },
  {
    id: "tl-1039",
    title: "Developer documentation",
    category: "Technical writing",
    client: "Fieldwork",
    freelancer: "Alex Morgan",
    role: "Freelancer",
    state: "Completed",
    escrowed: 0n,
    description: "A practical developer guide and reference library.",
    milestones: [
      {
        title: "Outline",
        amount: usd(200),
        state: "Approved",
        due: "2026-10-20",
      },
      {
        title: "Writing",
        amount: usd(400),
        state: "Approved",
        due: "2026-10-28",
      },
      {
        title: "Handoff",
        amount: usd(200),
        state: "Approved",
        due: "2026-11-01",
      },
    ],
  },
];
export const disputes: Dispute[] = [
  {
    id: "dp-2001",
    projectId: "tl-1043",
    milestoneIndex: 1,
    state: "Voting open",
    openedAt: "2026-11-17T10:00:00Z",
    responseDeadline: "2026-11-17T22:00:00Z",
    votingDeadline: "2026-11-18T22:00:00Z",
    reason:
      "The participants disagree about whether the illustration set meets the agreed creative direction.",
  },
  {
    id: "dp-2002",
    projectId: "tl-1044",
    milestoneIndex: 0,
    state: "Response window",
    openedAt: "2026-11-18T08:00:00Z",
    responseDeadline: "2026-11-18T20:00:00Z",
    votingDeadline: "2026-11-19T20:00:00Z",
    reason:
      "The participants need an independent review of the prototype's agreed scope.",
  },
];
export const totalProjectAmount = (project: Project) =>
  project.milestones.reduce((sum, m) => sum + m.amount, 0n);
