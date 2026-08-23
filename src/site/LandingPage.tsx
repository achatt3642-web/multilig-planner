import { publicAssetPath } from "../publicAssetPath";
import { SiteHeader } from "./SiteHeader";

const references = [
  {
    id: "reference-1",
    label: "International expert consensus on MLKI nomenclature, diagnosis, treatment, and rehabilitation (2024)",
    href: "https://pubmed.ncbi.nlm.nih.gov/39237264/",
  },
  {
    id: "reference-2",
    label: "Umbrella review of systematic reviews on multiligament knee injuries (2025)",
    href: "https://pubmed.ncbi.nlm.nih.gov/40276798/",
  },
  {
    id: "reference-3",
    label: "Scoping review of diagnosis and treatment strategies for the multiligament injured knee (2023)",
    href: "https://pubmed.ncbi.nlm.nih.gov/36822842/",
  },
  {
    id: "reference-4",
    label: "Evidence review of operative and nonoperative MLKI treatment outcomes (2011)",
    href: "https://pubmed.ncbi.nlm.nih.gov/21540715/",
  },
] as const;

function Citation({ number }: { number: 1 | 2 | 3 | 4 }) {
  return <sup><a href={`#reference-${number}`} aria-label={`Reference ${number}`}>{number}</a></sup>;
}

export default function LandingPage() {
  return (
    <div className="site-landing-shell">
      <a className="site-skip-link" href="#main-content">Skip to content</a>
      <SiteHeader active="surgery" />

      <main id="main-content" className="site-landing-main">
        <section className="site-hero" aria-labelledby="site-title">
          <div className="site-hero-glow" aria-hidden="true" />
          <div className="site-content site-hero-layout">
            <div className="site-hero-copy">
              <p className="site-eyebrow">Clinician-directed planning</p>
              <h1 id="site-title">Multilig Planner</h1>
              <p className="site-hero-lead">
                A three-dimensional workspace for bringing the moving parts of a complex
                multiligament knee plan into one patient-specific view.
              </p>
              <div className="site-hero-actions">
                <a className="site-primary-link" href="./demo.html">Open application demo</a>
                <a className="site-secondary-link" href="#injury">Learn about the surgery</a>
              </div>
              <p className="site-availability">
                <span aria-hidden="true" /> Application will be available for download soon.
              </p>
            </div>

            <div className="site-hero-visual">
              <div className="site-visual-frame">
                <img
                  src={publicAssetPath("multilig-planner-logo.png")}
                  alt="Illustration of a knee with multiple reconstructed ligaments"
                />
              </div>
              <div className="site-visual-caption">
                <span>Whole-knee perspective</span>
                <span>Case-specific planning</span>
              </div>
            </div>
          </div>
        </section>

        <div className="site-content site-education">
          <section id="injury" className="site-education-section" aria-labelledby="injury-heading">
            <div className="site-section-label">The injury</div>
            <div className="site-section-copy">
              <h2 id="injury-heading">What is a multiligament knee injury?</h2>
              <p>
                A multiligament knee injury involves high-grade injury to at least two of the
                knee&apos;s principal stabilizing ligament structures. It can involve the ACL, PCL,
                medial structures, posterolateral corner, or a combination of these regions.
                Not every multiligament injury is caused by a knee dislocation.<Citation number={1} />
              </p>
              <p>
                These injuries are uncommon compared with isolated ligament tears, and reported
                frequency depends heavily on the population and definition used. One recent
                umbrella review described them as approximately <strong>0.2% of orthopaedic injuries</strong>
                {" "}and <strong>11–20% of knee-ligament sprains</strong> in the literature it reviewed.
                <Citation number={2} />
              </p>
              <div className="site-context-note">
                Published estimates are not directly interchangeable. Injury definitions,
                referral patterns, and study populations vary.
              </div>
            </div>
          </section>

          <section className="site-education-section" aria-labelledby="why-heading">
            <div className="site-section-label">Why surgery is performed</div>
            <div className="site-section-copy">
              <h2 id="why-heading">Treatment is individualized.</h2>
              <p>
                Some knees can remain unstable in more than one direction after a multiligament
                injury. Depending on the structures involved, tissue quality, associated injuries,
                examination, imaging, and the patient&apos;s goals, the treating team may discuss repair,
                reconstruction, staged treatment, or nonoperative care.<Citation number={1} />
              </p>
              <p>
                When surgery is chosen, it is performed to address the particular pattern of
                instability and associated injury—not simply because more than one ligament is torn.
                The decision and timing belong to the patient and their clinical team.
              </p>
            </div>
          </section>

          <section className="site-education-section" aria-labelledby="goals-heading">
            <div className="site-section-label">Goals of surgery</div>
            <div className="site-section-copy">
              <h2 id="goals-heading">A stable, functional knee.</h2>
              <p>
                The broad goals are to restore useful stability and motion, support daily or
                athletic function, and address important associated injuries while preserving a
                path to rehabilitation. The balance among these goals differs from case to case.
                <Citation number={4} />
              </p>
              <div className="site-goal-grid" aria-label="Broad goals of multiligament knee surgery">
                <article><span>01</span><h3>Stability</h3><p>Address instability across the planes affected by the injury.</p></article>
                <article><span>02</span><h3>Motion</h3><p>Balance reconstruction with protection against stiffness.</p></article>
                <article><span>03</span><h3>Function</h3><p>Support the patient&apos;s individualized activity and recovery goals.</p></article>
              </div>
            </div>
          </section>

          <section className="site-education-section" aria-labelledby="challenges-heading">
            <div className="site-section-label">Surgical challenges</div>
            <div className="site-section-copy">
              <h2 id="challenges-heading">Several decisions must work together.</h2>
              <p>
                These cases can combine multiple injured structures with meniscal, cartilage,
                fracture, nerve, or vascular considerations. Surgeons may need to coordinate
                treatment timing, repair versus reconstruction, graft and fixation choices,
                anatomic targets, and rehabilitation priorities.<Citation number={3} />
              </p>
              <ul className="site-challenge-list">
                <li><strong>Patient-specific anatomy:</strong> available bone, prior surgery, injury pattern, and tissue quality vary.</li>
                <li><strong>Shared surgical space:</strong> multiple planned constructs may occupy nearby regions of the femur, tibia, or fibula.</li>
                <li><strong>Operative coordination:</strong> exposure, preparation, graft passage, fixation, and sequence influence one another.</li>
                <li><strong>Evidence limitations:</strong> published techniques and rehabilitation protocols are heterogeneous.</li>
              </ul>
            </div>
          </section>

          <section className="site-education-section site-planner-section" aria-labelledby="planner-heading">
            <div className="site-section-label">The unmet need</div>
            <div className="site-section-copy">
              <h2 id="planner-heading">Planning the case as a whole.</h2>
              <p>
                Complex reconstructions are often described procedure by procedure, even though the
                decisions coexist in the same knee. Multilig Planner is being developed as a shared
                spatial workspace where a clinician can organize case-specific anatomy, planned
                constructs, and alternatives together.
              </p>
              <p>
                The software is intended to help clinicians visualize and communicate a plan. It
                does not decide which operation should be performed, recommend treatment, or replace
                independent surgical judgment.
              </p>
              <a className="site-primary-link" href="./demo.html">Explore the de-identified demo</a>
            </div>
          </section>
        </div>

        <section className="site-evidence" aria-labelledby="evidence-heading">
          <div className="site-content site-evidence-layout">
            <div>
              <p className="site-eyebrow">Evidence and context</p>
              <h2 id="evidence-heading">Selected sources</h2>
              <p>
                This overview is general education. Published MLKI research uses varying definitions,
                techniques, timing, and rehabilitation protocols, and high-quality comparative
                evidence remains limited.
              </p>
            </div>
            <ol className="site-reference-list">
              {references.map((reference, index) => (
                <li id={reference.id} key={reference.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <a href={reference.href} target="_blank" rel="noreferrer">{reference.label}</a>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <aside className="site-research-notice" aria-label="Research notice">
          <div className="site-content">
            <strong>Research and development notice</strong>
            <p>
              Multilig Planner is clinician-directed planning software in development. The public
              demonstration is not validated for clinical care and is not medical advice, autonomous
              navigation, or an operative recommendation engine.
            </p>
          </div>
        </aside>
      </main>

      <footer className="site-footer">
        <div className="site-content site-footer-inner">
          <span>Multilig Planner</span>
          <span>Clinician-directed 3D planning</span>
        </div>
      </footer>
    </div>
  );
}
