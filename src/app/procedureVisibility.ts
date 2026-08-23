import type { ProcedureIdentity } from "../domain/types";

export interface ProcedureVisibilityTransition {
  highlighted: ProcedureIdentity[];
  focused: ProcedureIdentity;
  action: "show" | "focus" | "hide";
}

/**
 * Keeps render visibility independent from the single procedure whose channel
 * controls are open. A highlighted-but-unfocused procedure is focused on its
 * first click and remains rendered; only a second click hides it.
 */
export function toggleProcedureVisibility(
  highlighted: readonly ProcedureIdentity[],
  focused: ProcedureIdentity | null,
  identity: ProcedureIdentity,
): ProcedureVisibilityTransition {
  const isHighlighted = highlighted.includes(identity);
  if (!isHighlighted) {
    return { highlighted: [...highlighted, identity], focused: identity, action: "show" };
  }
  if (focused !== identity) {
    return { highlighted: [...highlighted], focused: identity, action: "focus" };
  }
  return {
    highlighted: highlighted.filter((candidate) => candidate !== identity),
    focused: identity,
    action: "hide",
  };
}
