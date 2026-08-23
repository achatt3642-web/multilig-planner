import { describe, expect, it } from "vitest";
import type { Bone, GeometryType, ProcedureIdentity } from "../domain/types";
import { TECHNIQUE_PRESETS } from "../presets/techniquePresets";
import { classifyChannelEntryTether } from "./channelEntryTether";

const channel = (bone: Bone, geometryType: GeometryType = "round_full_tunnel") => ({
  bone,
  geometryType,
});

describe("channel entry/start tether semantics", () => {
  it.each([
    ["ACL", "ACL entry"],
    ["PCL", "PCL entry"],
    ["MEDIAL_ROOT", "Medial root entry"],
    ["LATERAL_ROOT", "Lateral root entry"],
  ] satisfies Array<[ProcedureIdentity, string]>)(
    "classifies a tibial %s intra-articular entry as the tibial plateau",
    (procedure, entryLabel) => {
      expect(classifyChannelEntryTether(channel("tibia"), procedure)).toEqual({
        kind: "intra_articular_tibial_plateau",
        bone: "tibia",
        surfaceKey: "tibia:plateau",
        entryLabel,
        targetLabel: "Tibial plateau",
        conciseLabel: `${entryLabel} → Tibial plateau`,
      });
    },
  );

  it.each([
    ["femur", "Femur"],
    ["tibia", "Tibia"],
    ["fibula", "Fibula"],
    ["patella", "Patella"],
    ["custom", "Custom bone"],
  ] satisfies Array<[Bone, string]>)(
    "tethers a declared %s start to that bone surface",
    (bone, label) => {
      expect(classifyChannelEntryTether(channel(bone), "PLC_FCL")).toEqual({
        kind: "declared_bone_surface",
        bone,
        surfaceKey: `bone:${bone}:surface`,
        entryLabel: `${label} start`,
        targetLabel: `${label} surface`,
        conciseLabel: `${label} start → ${label} surface`,
      });
    },
  );

  it("keeps a PCL inlay trough on the posterior declared tibial surface", () => {
    const result = classifyChannelEntryTether(channel("tibia", "pcl_inlay_trough"), "PCL");
    expect(result.kind).toBe("declared_bone_surface");
    expect(result.surfaceKey).toBe("bone:tibia:surface");
    expect(result.conciseLabel).toBe("Tibia start → Tibia surface");
  });

  it("does not infer a plateau target without both tibia and a known intra-articular procedure", () => {
    expect(classifyChannelEntryTether(channel("femur"), "ACL").kind).toBe("declared_bone_surface");
    expect(classifyChannelEntryTether(channel("tibia"), "ALL").kind).toBe("declared_bone_surface");
    expect(classifyChannelEntryTether(channel("tibia"), null).kind).toBe("declared_bone_surface");
  });

  it("classifies every data-driven preset channel without changing its declared bone", () => {
    for (const preset of TECHNIQUE_PRESETS) {
      for (const seed of preset.channelSeeds) {
        const result = classifyChannelEntryTether(seed, preset.procedure);
        const expectsPlateau =
          seed.bone === "tibia" &&
          ["ACL", "PCL", "MEDIAL_ROOT", "LATERAL_ROOT"].includes(preset.procedure) &&
          seed.geometryType !== "pcl_inlay_trough";

        expect(result.bone, `${preset.id}/${seed.key}`).toBe(seed.bone);
        expect(result.kind, `${preset.id}/${seed.key}`).toBe(
          expectsPlateau ? "intra_articular_tibial_plateau" : "declared_bone_surface",
        );
        expect(result.entryLabel, `${preset.id}/${seed.key}`).not.toHaveLength(0);
        expect(result.targetLabel, `${preset.id}/${seed.key}`).not.toHaveLength(0);
      }
    }
  });
});
