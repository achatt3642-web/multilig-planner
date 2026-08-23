import { describe, expect, it } from "vitest";
import { toggleProcedureVisibility, withoutGraftPreviewsForProcedure } from "./procedureVisibility";

describe("procedure Viewer visibility", () => {
  it("shows the first explicitly selected procedure", () => {
    expect(toggleProcedureVisibility([], null, "ACL")).toEqual({
      highlighted: ["ACL"],
      focused: "ACL",
      action: "show",
    });
  });

  it("keeps multiple procedures highlighted", () => {
    expect(toggleProcedureVisibility(["ACL"], "ACL", "PCL")).toEqual({
      highlighted: ["ACL", "PCL"],
      focused: "PCL",
      action: "show",
    });
  });

  it("focuses an already highlighted procedure without hiding it", () => {
    expect(toggleProcedureVisibility(["ACL", "PCL"], "PCL", "ACL")).toEqual({
      highlighted: ["ACL", "PCL"],
      focused: "ACL",
      action: "focus",
    });
  });

  it("hides only the highlighted procedure that is already focused", () => {
    expect(toggleProcedureVisibility(["ACL", "PCL"], "ACL", "ACL")).toEqual({
      highlighted: ["PCL"],
      focused: "ACL",
      action: "hide",
    });
  });
});

describe("procedure graft-preview visibility", () => {
  it("resets only the previews owned by a newly shown or hidden procedure", () => {
    expect(withoutGraftPreviewsForProcedure([
      "ACL:single:acl-femur:acl-tibia",
      "PCL:al:pcl-al-femur:pcl-tibia",
      "PCL:pm:pcl-pm-femur:pcl-tibia",
    ], "PCL")).toEqual(["ACL:single:acl-femur:acl-tibia"]);
  });

  it("does not confuse procedures that share a leading substring", () => {
    expect(withoutGraftPreviewsForProcedure(["ALL:single:femur:tibia"], "ACL"))
      .toEqual(["ALL:single:femur:tibia"]);
  });
});
