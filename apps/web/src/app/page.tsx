import Link from "next/link";
import { Specimen } from "../ui/landing/specimen";

/** Each step of a check, with who does it: the product's rule is that the model never decides. */
const steps = [
  {
    who: "The model",
    title: "Find the decisions",
    text: "It reads the transcript, lists each decision with the line it came from, and marks the details that could be read more than one way: who owns it, what a date means, what done includes.",
  },
  {
    who: "The model drafts, you choose",
    title: "Ask each person privately",
    text: "It drafts a short multiple-choice question for each of those details. You edit, withdraw or send up to five. Each person answers on their own link, and nobody sees another answer until the reveal.",
  },
  {
    who: "Code",
    title: "Compare the answers",
    text: "Code compares the answers option by option. The model never decides whether people agree.",
  },
  {
    who: "Everyone",
    title: "Settle the wording",
    text: "Where answers differ, the group writes wording that settles it, or asks the model for a first draft, and each person confirms it.",
  },
  {
    who: "The model asks, code compares",
    title: "Recheck",
    text: "A new question about what the wording means in practice shows whether it really settled the difference.",
  },
  {
    who: "Code",
    title: "Keep the record",
    text: "Each item lands in one of three places: stated in the meeting, confirmed by participants, or unresolved. Each one links back to the line it came from.",
  },
];

export default function HomePage() {
  return (
    <main className="landing">
      <section className="landing-hero" aria-labelledby="landing-heading">
        <div className="landing-pitch">
          <h1 id="landing-heading">Everyone agreed. On the same thing?</h1>
          <p className="landing-lede">
            ForkCheck reads a meeting transcript, finds the decisions people could take more than
            one way, and asks each person privately what they understood. Where the answers differ,
            you settle the wording together, before anyone acts on it.
          </p>
          <div className="actions">
            <Link className="button button-primary" href="/new?sample">
              Try the sample meeting
            </Link>
            <Link className="button button-secondary" href="/new">
              Check your own meeting
            </Link>
          </div>
        </div>
        <figure className="landing-specimen">
          <figcaption>
            From the sample meeting. Everyone said yes to &ldquo;the end of next week&rdquo;. Asked
            privately, June meant Thursday.
          </figcaption>
          <Specimen />
        </figure>
      </section>

      <section className="landing-loop" aria-labelledby="loop-heading">
        <h2 id="loop-heading">What a check does</h2>
        <ol className="loop-list">
          {steps.map((s) => (
            <li key={s.title}>
              <p className="loop-who">{s.who}</p>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-facts" aria-label="Access and privacy">
        <div>
          <h2>No accounts. Everyone gets a link.</h2>
          <p>
            Each participant opens their own private link, on a phone or a laptop. After the reveal
            they see the same answers and the same record as you. The meeting checks you start are
            kept under <Link href="/meetings">Your meetings</Link>, in this browser only.
          </p>
        </div>
        <div>
          <h2>What is sent, and for how long</h2>
          <p>
            The transcript and participant names go to Meta&apos;s model API, Muse Spark. You can
            hide the names, and the model sees Person A, Person B and so on. A recording goes to
            Meta&apos;s Voice Transcribe. A meeting check is deleted after 7 days, or sooner if you
            delete it.
          </p>
        </div>
      </section>

      <footer className="landing-credit">
        <p>
          Asking privately with multiple-choice questions follows Liu et al.,{" "}
          <a href="https://arxiv.org/abs/2608.08210">&ldquo;Illusion of Alignment&rdquo;</a> (EMNLP
          2026). Settling, rechecking and the record are ForkCheck&apos;s own.{" "}
          <a href="https://github.com/FadeHack/ForkCheck">Source on GitHub</a>, Apache-2.0.
        </p>
      </footer>
    </main>
  );
}
