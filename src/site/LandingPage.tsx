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
              corner, or several of these regions may be involved.
            </p>
          </section>

          <section aria-labelledby="frequency-heading">
            <h2 id="frequency-heading">How common is it?</h2>
            <p>
              Although their true U.S. incidence is unknown and likely underestimated, available
              population and operative data suggest that approximately 10,000 MLKIs occur annually
              in the United States, with an estimated 4,000 patients undergoing multiligament repair
              or reconstruction each year.
            </p>
          </section>

          <section aria-labelledby="why-heading">
            <h2 id="why-heading">Why might surgery be performed?</h2>
            <p>
              Some knees remain unstable after injury. Depending on the structures involved, tissue
              quality, associated injuries, examination, imaging, and the patient&apos;s goals, repair,
              reconstruction, staged treatment, or nonoperative care may be recommended. When
              surgery is chosen, it is intended to address the particular pattern of instability
              and associated injury. The broad goals are to restore stability and motion, address
              important associated injuries, and support the patient&apos;s daily, occupational, or
              athletic function. The surgical plan also needs to preserve a practical path through
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
            <p><a className="site-text-link" href="./demo.html">View the application demo</a></p>
            <p className="site-availability">Application will be available for download soon.</p>
          </section>
        </article>
      </main>
    </div>
  );
}
