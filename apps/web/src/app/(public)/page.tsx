import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  FileCheck2,
  Gavel,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/shell";
import { ButtonLink, TimelineItem } from "@/components/ui";

export default function LandingPage() {
  return (
    <>
      <div className="public-container">
        <header className="public-header">
          <Logo />
          <nav className="public-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#resolution">Dispute resolution</a>
            <a href="#jurors">For jurors</a>
          </nav>
          <ButtonLink href="/dashboard" variant="secondary">
            Explore workspace
            <ArrowRight size={15} />
          </ButtonLink>
        </header>
        <main id="main">
          <section className="hero">
            <div>
              <p className="eyebrow">INDEPENDENT WORK. SHARED CONFIDENCE.</p>
              <h1>
                Good work deserves a clear path to <span>payment.</span>
              </h1>
              <p className="hero-copy">
                Agree on the work. Fund the agreement. Move forward with
                transparent escrow and a clear process when things don’t go to
                plan.
              </p>
              <div className="hero-actions">
                <ButtonLink href="/dashboard">
                  Explore the preview
                  <ArrowRight size={16} />
                </ButtonLink>
                <ButtonLink href="#how-it-works" variant="secondary">
                  How it works
                </ButtonLink>
              </div>
              <p className="hero-note">
                <ShieldCheck size={13} />
                Local development preview · No wallet required
              </p>
            </div>
            <div className="hero-preview">
              <p className="preview-label">
                ILLUSTRATIVE PROJECT · SAMPLE DATA
              </p>
              <span className="badge badge-blue">Milestone-based escrow</span>
              <h2>A better brand, together.</h2>
              <p className="small text-muted mt-1">
                A simple agreement. A clear next step.
              </p>
              <div className="preview-total">
                <p className="small text-muted">Example project budget</p>
                <strong>
                  1,000.00{" "}
                  <span className="text-muted text-sm font-normal">mUSD</span>
                </strong>
              </div>
              <div className="preview-milestone">
                <CheckCircle2 size={17} />
                <span>01 · Creative direction</span>
                <strong>400 mUSD</strong>
              </div>
              <div className="preview-milestone">
                <FileCheck2 size={17} />
                <span>02 · Design & handoff</span>
                <strong>600 mUSD</strong>
              </div>
              <div className="preview-secured">
                <LockKeyhole size={13} />
                Milestones define when funds can move
              </div>
            </div>
          </section>
          <div className="protocol-strip" aria-label="Protocol rules">
            <div>
              <strong>1%</strong>
              <span>
                Service fee on
                <br />
                freelancer payouts
              </span>
            </div>
            <div>
              <strong>3 jurors</strong>
              <span>
                Independent review
                <br />
                for every dispute
              </span>
            </div>
            <div>
              <strong>15 mUSD</strong>
              <span>
                Dispute opening fee
                <br />
                paid by the opener
              </span>
            </div>
          </div>
          <section className="public-section" id="how-it-works">
            <div className="section-intro">
              <p className="eyebrow">FROM AGREEMENT TO DELIVERY</p>
              <h2>
                Less uncertainty.
                <br />
                More room for good work.
              </h2>
              <p>
                Every project has a defined scope, a funded plan, and explicit
                rules for review.
              </p>
            </div>
            <div className="steps-grid">
              {[
                {
                  Icon: BriefcaseBusiness,
                  title: "Agree on the milestones",
                  description:
                    "Define one to five sequential milestones, amounts and delivery dates. The freelancer reviews and accepts the funded project.",
                },
                {
                  Icon: LockKeyhole,
                  title: "Keep funds in escrow",
                  description:
                    "The client funds the project in MockUSD. Funds remain accounted for in escrow until the contract permits settlement.",
                },
                {
                  Icon: FileCheck2,
                  title: "Deliver, review, move forward",
                  description:
                    "Deliver work privately and record its evidence hash. The client has 72 hours to review each submitted milestone. Private file storage is planned for a later phase.",
                },
              ].map(({ Icon, title, description }, i) => (
                <article className="step" key={title}>
                  <span className="step-number">0{i + 1}</span>
                  <Icon size={25} strokeWidth={1.5} aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
      <section className="arbitration-section" id="resolution">
        <div className="public-container">
          <div className="arbitration-grid">
            <div className="section-intro">
              <p className="eyebrow">A PROCESS WHEN YOU NEED ONE</p>
              <h2>A disagreement doesn’t have to be a dead end.</h2>
              <p>
                Either participant can open an eligible milestone dispute. Funds
                freeze while three eligible jurors review the case. Two matching
                votes decide the outcome; without a valid majority, funds split
                50/50.
              </p>
              <p className="small mt-5">
                Jurors rotate deterministically. Selection is not
                cryptographically random.
              </p>
            </div>
            <div className="public-timeline">
              <ul className="timeline">
                <TimelineItem
                  title="Open a dispute"
                  detail="The opener pays 15 mUSD; the milestone freezes."
                  state="done"
                />
                <TimelineItem
                  title="12 hours to respond"
                  detail="Participants prepare their side. Juror voting has not started."
                  state="current"
                />
                <TimelineItem
                  title="24 hours to vote"
                  detail="Three assigned jurors may vote after the response deadline."
                />
                <TimelineItem
                  title="Finalize after the voting deadline"
                  detail="Anyone may finalize. Escrow settles once and stake locks release."
                />
              </ul>
            </div>
          </div>
        </div>
      </section>
      <div className="public-container">
        <section className="juror-callout" id="jurors">
          <div>
            <p className="eyebrow">HELP RESOLVE WHAT’S NEXT</p>
            <h2>Bring an independent perspective.</h2>
            <p>
              Jurors need at least 100 mUSD of available stake per assignment.
              Finalized cases reserve a fixed 4 mUSD claim for each assigned
              juror.
            </p>
          </div>
          <ButtonLink href="/juror" variant="secondary">
            <Gavel size={16} />
            Explore juror workspace
            <ArrowRight size={15} />
          </ButtonLink>
        </section>
        <footer className="public-footer">
          <Logo />
          <p>
            TrustLayer is an unaudited development protocol. MockUSD has no real
            monetary value. This interface preview does not connect a wallet or
            execute transactions.
          </p>
        </footer>
      </div>
    </>
  );
}
