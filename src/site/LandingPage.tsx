import { SiteHeader } from "./SiteHeader";

export default function LandingPage() {
  return (
    <div className="site-landing-shell">
      <a className="site-skip-link" href="#main-content">Skip to content</a>
      <SiteHeader active="surgery" />

      <main id="main-content" className="site-landing-main">
        <article className="site-article">
          <header className="site-article-introduction">
            <h1>Multiligament Knee Surgery</h1>
            <p className="site-article-lead">
              Multiligament knee injuries affect more than one of the structures that stabilize
              the knee. Because the pattern and severity of injury differ from one patient to the
              next, evaluation, treatment, and rehabilitation must be individualized.
            </p>
          </header>

          <section id="injury" aria-labelledby="injury-heading">
            <h2 id="injury-heading">What is a multiligament knee injury?</h2>
            <p>
              These injuries involve high-grade damage to at least two of the knee&apos;s principal
              stabilizing ligament structures. The ACL, PCL, medial structures, posterolateral
              corner, or several of these regions may be involved. They can occur with a knee
              dislocation, but not every multiligament injury is caused by one.
            </p>
          </section>

          <section aria-labelledby="frequency-heading">
            <h2 id="frequency-heading">How common is it?</h2>
            <p>
              Multiligament knee injuries are uncommon compared with isolated ligament tears.
              Published frequency estimates vary because studies use different definitions and
              examine different patient populations. A recent review described them as roughly
              0.2% of orthopaedic injuries and 11–20% of knee-ligament sprains, but those estimates
              are not interchangeable across clinical settings.
            </p>
          </section>

          <section aria-labelledby="why-heading">
            <h2 id="why-heading">Why might surgery be performed?</h2>
            <p>
              Some knees remain unstable in more than one direction after injury. Depending on the
              structures involved, tissue quality, associated injuries, examination, imaging, and
              the patient&apos;s goals, the clinical team may discuss repair, reconstruction, staged
              treatment, or nonoperative care.
            </p>
            <p>
              When surgery is chosen, it is intended to address the particular pattern of
              instability and associated injury—not simply the number of torn ligaments. The
              decision and timing belong to the patient and their treating clinicians.
            </p>
          </section>

          <section aria-labelledby="goals-heading">
            <h2 id="goals-heading">Goals of surgery</h2>
            <p>
              The broad goals are to restore useful stability and motion, address important
              associated injuries, and support the patient&apos;s daily, occupational, or athletic
              function. The surgical plan also needs to preserve a practical path through
              rehabilitation while limiting avoidable stiffness and protecting healing tissue.
            </p>
          </section>

          <section aria-labelledby="challenges-heading">
            <h2 id="challenges-heading">Challenges in surgical planning</h2>
            <p>
              Multiligament operations bring several decisions into the same knee. Patient-specific
              anatomy, the injury pattern, tissue quality, prior surgery, and meniscal, cartilage,
              fracture, nerve, or vascular considerations can all affect the plan.
            </p>
            <p>
              Planned tunnels, sockets, anchors, grafts, and fixation may occupy nearby regions of
              the femur, tibia, or fibula. Their positions, trajectories, dimensions, and operative
              sequence therefore need to be considered together rather than as unrelated steps.
            </p>
          </section>

          <section aria-labelledby="planner-heading">
            <h2 id="planner-heading">How Multilig Planner may help</h2>
            <p>
              Multilig Planner is being developed as a clinician-directed, three-dimensional
              workspace for viewing case-specific anatomy and organizing the components of a
              multiligament plan in one place. Surgical planning software may help clinicians
              explore alternatives, understand spatial relationships, and communicate a plan more
              clearly before a procedure.
            </p>
            <p>
              The software does not decide which operation should be performed, recommend a
              technique, or replace independent clinical judgment. The current public demonstration
              is not validated for clinical care, and the information on this page is not medical
              advice.
            </p>
            <p><a className="site-text-link" href="./demo.html">View the application demo</a></p>
            <p className="site-availability">Application will be available for download soon.</p>
          </section>
        </article>
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
