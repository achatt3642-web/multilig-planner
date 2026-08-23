(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const procedureDefaults = { acl: true, pcl: true, fcl: true, pop: true, mcl: false, root: false };
  const procedureCards = $$(".procedure-card");
  const scene = $("#knee-scene");
  const canvas = $("#viewer-canvas");
  const fclAngle = $("#fcl-angle");
  const popAngle = $("#pop-angle");
  const envelopeToggle = $("#collision-envelopes");
  let rotationX = -2;
  let rotationY = -9;
  let scale = .94;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startRotationX = rotationX;
  let startRotationY = rotationY;

  const activeProcedures = () => Object.fromEntries(procedureCards.map((card) => [card.dataset.procedure, $("input", card).checked]));

  const applyView = () => {
    if (!scene) return;
    scene.style.transform = `perspective(900px) rotateX(${rotationX}deg) rotateY(${rotationY}deg) scale(${scale})`;
  };

  const updateProcedureUI = () => {
    const active = activeProcedures();
    procedureCards.forEach((card) => card.classList.toggle("is-selected", $("input", card).checked));
    Object.entries(active).forEach(([name, enabled]) => {
      $$(`[data-tunnel="${name}"], [data-label="${name}"], [data-legend="${name}"]`).forEach((element) => element.classList.toggle("is-hidden", !enabled));
    });

    const graftCount = Object.values(active).filter(Boolean).length;
    const femur = Number(active.acl) + Number(active.pcl) + Number(active.fcl) + Number(active.pop) + Number(active.mcl);
    const tibia = Number(active.acl) + Number(active.pcl) + Number(active.pop) + Number(active.root);
    const fibula = Number(active.fcl || active.pop);
    $("#graft-count").textContent = String(graftCount);
    $("#femur-count").textContent = `${femur} ${femur === 1 ? "tunnel" : "tunnels"}`;
    $("#tibia-count").textContent = `${tibia} ${tibia === 1 ? "tunnel" : "tunnels"}`;
    $("#fibula-count").textContent = `${fibula} ${fibula === 1 ? "tunnel" : "tunnels"}`;
    runConvergenceCheck(false);
    buildSequence();
  };

  const calculateClearance = (angle, offset = 0) => Math.max(.7, Math.min(7.4, .12 * angle - .35 + offset));

  function runConvergenceCheck(animate = true) {
    const active = activeProcedures();
    const fclValue = Number(fclAngle?.value || 18);
    const popValue = Number(popAngle?.value || 22);
    const fclClearance = active.fcl && active.acl ? calculateClearance(fclValue) : 7.2;
    const popClearance = active.pop && active.acl ? calculateClearance(popValue, 1.3) : 7.4;
    const risk = Math.min(fclClearance, popClearance) < 3;

    $("#fcl-angle-output").textContent = `${fclValue}°`;
    $("#pop-angle-output").textContent = `${popValue}°`;
    $("#acl-fcl-clearance").textContent = `${fclClearance.toFixed(1)} mm`;
    $("#acl-pop-clearance").textContent = `${popClearance.toFixed(1)} mm`;
    $("#acl-fcl-clearance").classList.toggle("warning-value", fclClearance < 3);
    $("#acl-pop-clearance").classList.toggle("warning-value", popClearance < 3);
    $("#acl-fcl-bar").style.width = `${Math.min(100, fclClearance * 12)}%`;
    $("#acl-pop-bar").style.width = `${Math.min(100, popClearance * 12)}%`;
    $("#acl-fcl-bar").parentElement.classList.toggle("good", fclClearance >= 3);
    $("#acl-pop-bar").parentElement.classList.toggle("good", popClearance >= 3);

    const summary = $("#check-summary");
    summary.classList.toggle("is-clear", !risk);
    summary.classList.toggle("is-warning", risk);
    $("#summary-icon").textContent = risk ? "!" : "✓";
    $("#summary-title").textContent = risk ? "Potential convergence" : "Trajectories clear";
    $("#summary-copy").textContent = risk ? "A lateral trajectory approaches the ACL femoral socket." : "All displayed tunnels meet the sample clearance threshold.";
    $("#check-count").textContent = risk ? "5 / 6" : "6 / 6";

    const check = $("#convergence-check .check");
    check.textContent = risk ? "!" : "✓";
    check.classList.toggle("warn", risk);
    check.classList.toggle("ok", !risk);
    $("#envelopes")?.classList.toggle("is-hidden", !envelopeToggle?.checked || !risk);

    const fclEndX = 610 + fclValue * .8;
    const fclEndY = 292 - fclValue * 1.3;
    $("#fcl-trajectory")?.setAttribute("d", `M483 305 L${fclEndX.toFixed(0)} ${fclEndY.toFixed(0)}`);
    const popEndX = 625 + popValue * .7;
    const popEndY = 342 - popValue * 1.45;
    $("#pop-trajectory")?.setAttribute("d", `M509 324 L${popEndX.toFixed(0)} ${popEndY.toFixed(0)}`);

    if (animate && summary) {
      summary.animate([{ transform: "scale(.985)", opacity: .7 }, { transform: "scale(1)", opacity: 1 }], { duration: 260, easing: "ease-out" });
    }
  }

  function buildSequence() {
    const active = activeProcedures();
    const steps = [
      ["Examination and exposure", "Confirm instability pattern, address associated pathology and identify anatomic footprints."],
      ["Prepare grafts", `${Object.values(active).filter(Boolean).length} planned constructs · confirm diameters and fixation.`],
    ];
    if (active.pcl) steps.push(["Create PCL tunnels", "Protect the posterior neurovascular structures and pass the PCL graft."]);
    if (active.acl) steps.push(["Create ACL tunnels", "Maintain planned separation from collateral and corner trajectories."]);
    if (active.fcl || active.pop) steps.push(["Prepare posterolateral reconstruction", "Create fibular/tibial work and planned lateral femoral trajectories."]);
    if (active.mcl) steps.push(["Prepare medial reconstruction", "Confirm relationship to the PCL femoral socket and preserve fixation options."]);
    if (active.root) steps.push(["Prepare medial root socket", "Coordinate transtibial trajectory with existing tibial tunnels."]);
    steps.push(["Pass grafts and reduce the knee", "Confirm graft mobility and restore the tibiofemoral relationship."]);
    steps.push(["Fix and tension", "Follow the surgeon-defined sequence, knee positions and final examination."]);

    const list = $("#sequence-list");
    if (!list) return;
    list.innerHTML = "";
    steps.forEach(([title, copy]) => {
      const item = document.createElement("li");
      const strong = document.createElement("strong");
      const span = document.createElement("span");
      strong.textContent = title;
      span.textContent = copy;
      item.append(strong, span);
      list.append(item);
    });
  }

  procedureCards.forEach((card) => $("input", card).addEventListener("change", updateProcedureUI));

  $("#reset-plan")?.addEventListener("click", () => {
    procedureCards.forEach((card) => { $("input", card).checked = procedureDefaults[card.dataset.procedure]; });
    if (fclAngle) fclAngle.value = "18";
    if (popAngle) popAngle.value = "22";
    updateProcedureUI();
  });

  $$(".app-step").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".app-step").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      $$(".panel-stage").forEach((panel) => panel.classList.toggle("is-hidden", panel.dataset.panel !== button.dataset.stage));
      if (button.dataset.stage === "sequence") buildSequence();
    });
  });

  fclAngle?.addEventListener("input", () => runConvergenceCheck(false));
  popAngle?.addEventListener("input", () => runConvergenceCheck(false));
  envelopeToggle?.addEventListener("change", () => runConvergenceCheck(false));
  $("#run-check")?.addEventListener("click", () => runConvergenceCheck(true));
  $("#update-sequence")?.addEventListener("click", () => buildSequence());

  $$(".view-btn").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".view-btn").forEach((item) => item.classList.toggle("is-active", item === button));
      const views = { oblique: [-2, -9], ap: [0, 0], lateral: [0, -78] };
      [rotationX, rotationY] = views[button.dataset.view];
      applyView();
    });
  });

  $("#zoom-in")?.addEventListener("click", () => { scale = Math.min(1.32, scale + .08); applyView(); });
  $("#zoom-out")?.addEventListener("click", () => { scale = Math.max(.62, scale - .08); applyView(); });
  $("#reset-view")?.addEventListener("click", () => {
    rotationX = -2; rotationY = -9; scale = .94; applyView();
    $$(".view-btn").forEach((button) => button.classList.toggle("is-active", button.dataset.view === "oblique"));
  });

  canvas?.addEventListener("pointerdown", (event) => {
    dragging = true;
    startX = event.clientX; startY = event.clientY;
    startRotationX = rotationX; startRotationY = rotationY;
    canvas.setPointerCapture(event.pointerId);
    scene?.classList.add("is-dragging");
  });
  canvas?.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    rotationY = startRotationY + (event.clientX - startX) * .25;
    rotationX = Math.max(-45, Math.min(45, startRotationX - (event.clientY - startY) * .18));
    applyView();
  });
  const endDrag = () => { dragging = false; scene?.classList.remove("is-dragging"); };
  canvas?.addEventListener("pointerup", endDrag);
  canvas?.addEventListener("pointercancel", endDrag);
  canvas?.addEventListener("wheel", (event) => {
    event.preventDefault();
    scale = Math.max(.62, Math.min(1.32, scale + (event.deltaY < 0 ? .06 : -.06)));
    applyView();
  }, { passive: false });

  updateProcedureUI();
  applyView();
})();
