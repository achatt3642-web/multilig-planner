import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TechniquePanel } from "./SimplifiedApp";
import { buildSyntheticAnatomyMeshes } from "./app/channelGeometry";
import { createSyntheticDemoCase } from "./app/caseFactory";
import { configureSimplifiedProcedure } from "./app/configureSimplifiedProcedure";
import { activeVariant } from "./app/planOperations";
import { graftPreviewTitle } from "./app/graftPreviewPresentation";
import {
  createEmptySimplifiedSelection,
  type SimplifiedBoneChoice,
  type SimplifiedTechniqueSelection,
} from "./app/simplifiedTechniqueFlow";
import type {
  ChannelStartPointMeasurement,
  ChannelTrajectoryAngleMeasurement,
} from "./geometry/anatomicReferencePlanes";

const bone = (overrides: Partial<SimplifiedBoneChoice>): SimplifiedBoneChoice => ({
  bundle: null,
  preparation: null,
  count: null,
  diameterMm: null,
  depthMm: null,
  ...overrides,
});

const configured = (
  procedure: SimplifiedTechniqueSelection["procedure"],
  overrides: Partial<SimplifiedTechniqueSelection>,
): SimplifiedTechniqueSelection => ({
  ...createEmptySimplifiedSelection(procedure),
  ...overrides,
});

function panelMarkup(
  draft: SimplifiedTechniqueSelection,
  stepIndex: number,
  startPointMeasurement: ChannelStartPointMeasurement | null = null,
  trajectoryMeasurement: ChannelTrajectoryAngleMeasurement | null = null,
): string {
  const result = configureSimplifiedProcedure(
    createSyntheticDemoCase(),
    draft,
    buildSyntheticAnatomyMeshes(),
  );
  const procedureIds = new Set(result.plan.procedures
    .filter((procedure) => procedure.structure === draft.procedure)
    .map((procedure) => procedure.id));
  const channels = activeVariant(result.plan).channels
    .filter((channel) => procedureIds.has(channel.procedureId));
  const measuredChannel = startPointMeasurement
    ? channels.find((channel) =>
      channel.bone === startPointMeasurement.bone &&
      channel.label === startPointMeasurement.channelLabel)
    : null;
  const trajectoryChannel = trajectoryMeasurement
    ? channels.find((channel) =>
      channel.bone === trajectoryMeasurement.bone &&
      channel.label === trajectoryMeasurement.channelLabel)
    : null;
  const boundMeasurement = startPointMeasurement && measuredChannel
    ? { ...startPointMeasurement, channelId: measuredChannel.id }
    : startPointMeasurement;
  const boundTrajectoryMeasurement = trajectoryMeasurement && trajectoryChannel
    ? { ...trajectoryMeasurement, channelId: trajectoryChannel.id }
    : trajectoryMeasurement;
  return renderToStaticMarkup(createElement(TechniquePanel, {
    draft,
    stepIndex,
    channels,
    selectedChannelId: boundMeasurement?.channelId ?? boundTrajectoryMeasurement?.channelId ?? null,
    startPointMeasurement: boundMeasurement,
    trajectoryMeasurement: boundTrajectoryMeasurement,
    geometryMatchesDraft: true,
    onDraft: () => undefined,
    onStep: () => undefined,
    onSelectChannel: () => undefined,
    onNumericChannel: () => undefined,
  }));
}

function evaluatedTrajectory(
  channelLabel: string,
  boneName: "femur" | "tibia",
  overrides: Partial<ChannelTrajectoryAngleMeasurement> = {},
): ChannelTrajectoryAngleMeasurement {
  return {
    evaluationState: "evaluated",
    channelId: "trajectory-channel",
    channelLabel,
    bone: boneName,
    sagittalToTibialPlateauDeg: 53.130102,
    coronalToTibialPlateauDeg: 63.434949,
    axialToPosteriorCondylarDeg: 56.309932,
    referenceFrameVersion: "4",
    provisional: false,
    reason: null,
    ...overrides,
  };
}

describe("simplified plan panel", () => {
  it("names cruciate graft previews by their explicit bundle roles", () => {
    expect(graftPreviewTitle({ procedure: "ACL", bundleRole: "AM" })).toBe("ACL AM");
    expect(graftPreviewTitle({ procedure: "ACL", bundleRole: "PL" })).toBe("ACL PL");
    expect(graftPreviewTitle({ procedure: "PCL", bundleRole: "AL" })).toBe("PCL AL");
    expect(graftPreviewTitle({ procedure: "PCL", bundleRole: "PM" })).toBe("PCL PM");
    expect(graftPreviewTitle({ procedure: "PCL", bundleRole: null })).toBe("PCL");
    expect(graftPreviewTitle({ procedure: "PLC_FCL", bundleRole: null })).toBe("PLC");
  });

  it("uses direct Femur/Tibia controls and renders only the active site's channel sliders", () => {
    const acl = configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    });
    const femurMarkup = panelMarkup(acl, 0);
    expect(femurMarkup).toContain("ACL Plan");
    expect(femurMarkup).toContain('aria-label="ACL bone plan"');
    expect(femurMarkup).toContain('aria-pressed="true">Femur</button>');
    expect(femurMarkup).toContain('aria-pressed="false">Tibia</button>');
    expect(femurMarkup).toContain('aria-label="ACL femur socket diameter"');
    expect(femurMarkup).toContain('aria-label="ACL femur socket depth"');
    expect(femurMarkup).toContain('aria-label="ACL femur socket pin diameter"');
    expect(femurMarkup).not.toContain('aria-label="ACL tibia full tunnel diameter"');

    const tibiaMarkup = panelMarkup(acl, 1);
    expect(tibiaMarkup).toContain('aria-pressed="false">Femur</button>');
    expect(tibiaMarkup).toContain('aria-pressed="true">Tibia</button>');
    expect(tibiaMarkup).toContain('aria-label="ACL tibia full tunnel diameter"');
    expect(tibiaMarkup).toContain('aria-label="ACL tibia full tunnel depth"');
    expect(tibiaMarkup).not.toContain('aria-label="ACL tibia full tunnel pin diameter"');
    expect(tibiaMarkup).not.toContain('aria-label="ACL femur socket diameter"');
  });

  it("omits the old stepper and manual geometry actions", () => {
    const pcl = configured("PCL", {
      femur: bone({ bundle: "double_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    });
    const markup = panelMarkup(pcl, 0);
    expect(markup).not.toContain("Update geometry");
    expect(markup).not.toContain("Create geometry");
    expect(markup).not.toContain("Next:");
    expect(markup).not.toContain(">Back<");
    expect(markup).not.toContain("simple-step-dots");
    expect(markup).not.toContain("Step 1 of 2");
    expect(markup).toContain('aria-label="PCL femur AL socket diameter"');
    expect(markup).toContain('aria-label="PCL femur PM socket diameter"');
    expect(markup).toContain('aria-label="PCL femur AL socket pin diameter"');
    expect(markup).toContain('aria-label="PCL femur PM socket pin diameter"');
  });

  it("shows only the anatomically applicable site for single-site plans", () => {
    const letPlan = panelMarkup(configured("LET", {
      femur: bone({ preparation: "socket_with_guide_pin" }),
    }), 0);
    expect(letPlan).toContain(">Femur</button>");
    expect(letPlan).not.toContain(">Tibia</button>");

    const rootPlan = panelMarkup(configured("MEDIAL_ROOT", {
      rootLocation: "posterior",
      tibia: bone({ preparation: "full_tunnel" }),
    }), 0);
    expect(rootPlan).toContain("Medial root Plan");
    expect(rootPlan).toContain(">Tibia</button>");
    expect(rootPlan).not.toContain(">Femur</button>");
  });

  it("keeps a Start-point readout pinned to the active bone when no channel is selected", () => {
    const acl = configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    });
    const markup = panelMarkup(acl, 1);
    expect(markup).toContain('aria-label="Tibia start point reference measurements"');
    expect(markup).toContain("Tibia Start Point");
    expect(markup).not.toContain("Rendered trajectory origin");
    expect(markup).toContain("Not evaluated");
    expect(markup).toContain("Select a channel with a defined Start point on this bone.");
    expect(markup).not.toContain("Uses the exact Start point shown by the Viewer hover label");
    expect(markup).not.toContain("Auto-derived reference planes require clinician review.");
  });

  it("never carries a same-bone Start measurement into a different focused procedure", () => {
    const acl = configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    });
    const staleMeasurement: ChannelStartPointMeasurement = {
      evaluationState: "evaluated",
      channelId: "unrelated-tibial-channel",
      channelLabel: "Unrelated tibial channel",
      bone: "tibia",
      pointPatientRasMm: [1, 2, 3],
      pointSource: "outer_cortex_surface_attachment",
      jointLineSignedMm: 1,
      midlineSignedMm: 2,
      midlineUnsignedMm: 2,
      posteriorCondylarSignedMm: 3,
      lateralityVerified: true,
      scaleVerified: true,
      provisional: false,
      reason: null,
    };
    const markup = panelMarkup(acl, 1, staleMeasurement);
    expect(markup).toContain("Tibia Start Point");
    expect(markup).toContain("Not evaluated");
    expect(markup).not.toContain("Unrelated tibial channel");
    expect(markup).not.toContain("1.0 mm superior from joint line");
  });

  it("reports verified signed distances with one decimal and makes geometry cards selectable", () => {
    const acl = configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    });
    const measurement: ChannelStartPointMeasurement = {
      evaluationState: "evaluated",
      channelId: "acl-femur",
      channelLabel: "ACL femur socket",
      bone: "femur",
      pointPatientRasMm: [1, 2, 3],
      pointSource: "outer_cortex_surface_attachment",
      jointLineSignedMm: -12.34,
      midlineSignedMm: 6.54,
      midlineUnsignedMm: 6.54,
      posteriorCondylarSignedMm: 7.24,
      lateralityVerified: true,
      scaleVerified: true,
      provisional: false,
      reason: null,
    };
    const markup = panelMarkup(
      acl,
      0,
      measurement,
      evaluatedTrajectory("ACL femur socket", "femur"),
    );
    expect(markup).toContain("12.3 mm inferior from joint line");
    expect(markup).toContain("6.5 mm lateral from midline");
    expect(markup).toContain("7.2 mm anterior from posterior condylar axis");
    expect(markup).not.toContain('class="joint"');
    expect(markup).not.toContain('class="midline"');
    expect(markup).not.toContain('class="posterior"');
    expect(markup).not.toContain("Provisional ·");
    expect(markup).toContain("Trajectory Angles");
    expect(markup).not.toContain("0° parallel · 90° perpendicular");
    expect(markup).toContain("Sagittal to tibial plateau axis");
    expect(markup).toContain("53.1°");
    expect(markup).toContain("Coronal to tibial plateau axis");
    expect(markup).toContain("63.4°");
    expect(markup).toContain("Axial to posterior condylar axis");
    expect(markup).toContain("56.3°");
    expect(markup).toContain('aria-label="Select ACL femur socket"');
  });

  it("does not display a trajectory measurement from a stale channel", () => {
    const acl = configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    });
    const staleTrajectory = evaluatedTrajectory("Unrelated femur socket", "femur", {
      sagittalToTibialPlateauDeg: 11.1,
    });
    const markup = panelMarkup(acl, 0, null, staleTrajectory);
    expect(markup).not.toContain("Sagittal to tibial plateau axis");
    expect(markup).not.toContain("11.1°");
  });

  it("withholds medial/lateral direction until verification without extra explanatory text", () => {
    const root = configured("MEDIAL_ROOT", {
      rootLocation: "posterior",
      tibia: bone({ preparation: "suture_anchor_location" }),
    });
    const measurement: ChannelStartPointMeasurement = {
      evaluationState: "evaluated",
      channelId: "medial-root-point",
      channelLabel: "Medial posterior root suture anchor location",
      bone: "tibia",
      pointPatientRasMm: [1, 2, 3],
      pointSource: "outer_cortex_surface_attachment",
      jointLineSignedMm: 2.25,
      midlineSignedMm: null,
      midlineUnsignedMm: 4.04,
      posteriorCondylarSignedMm: -5.25,
      lateralityVerified: false,
      scaleVerified: false,
      provisional: true,
      reason: null,
    };
    const markup = panelMarkup(root, 0, measurement);
    expect(markup).toContain("2.3 mm superior from joint line");
    expect(markup).toContain("4.0 mm from midline");
    expect(markup).toContain("5.3 mm posterior from posterior condylar axis");
    expect(markup).not.toContain("Medial/lateral side not evaluated until laterality is verified.");
    expect(markup).not.toContain("Provisional · clinician verification required for scale and laterality.");
    expect(markup).toContain('aria-label="Select Medial posterior root suture anchor location"');
  });

  it("shows the reference derivation failure instead of reassuring distances", () => {
    const letPlan = configured("LET", {
      femur: bone({ preparation: "socket_with_guide_pin" }),
    });
    const measurement: ChannelStartPointMeasurement = {
      evaluationState: "not_evaluated",
      channelId: "let-femur",
      channelLabel: "LET femur socket",
      bone: "femur",
      pointPatientRasMm: [1, 2, 3],
      pointSource: "outer_cortex_surface_attachment",
      jointLineSignedMm: null,
      midlineSignedMm: null,
      midlineUnsignedMm: null,
      posteriorCondylarSignedMm: null,
      lateralityVerified: false,
      scaleVerified: false,
      provisional: true,
      reason: "Both femur and tibia surface meshes are required.",
    };
    const markup = panelMarkup(letPlan, 0, measurement);
    expect(markup).toContain("Not evaluated");
    expect(markup).toContain("Both femur and tibia surface meshes are required.");
    expect(markup).not.toContain("mm superior");
    expect(markup).not.toContain("mm anterior");
  });

  it("fails closed instead of substituting zero for an incomplete evaluated measurement", () => {
    const acl = configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    });
    const measurement: ChannelStartPointMeasurement = {
      evaluationState: "evaluated",
      channelId: "acl-femur",
      channelLabel: "ACL femur socket",
      bone: "femur",
      pointPatientRasMm: [1, 2, 3],
      pointSource: "outer_cortex_surface_attachment",
      jointLineSignedMm: null,
      midlineSignedMm: 4,
      midlineUnsignedMm: 4,
      posteriorCondylarSignedMm: 5,
      lateralityVerified: true,
      scaleVerified: true,
      provisional: false,
      reason: null,
    };
    const markup = panelMarkup(acl, 0, measurement);
    expect(markup).toContain("Not evaluated");
    expect(markup).toContain("One or more reference-plane distances are unavailable.");
    expect(markup).not.toContain("0.0 mm from joint line");
  });
});
