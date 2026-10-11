export const quadrant = `quadrantChart
  title Priorities
  x-axis Low Reach --> High Reach
  y-axis Low Impact --> High Impact
  quadrant-1 Expand
  quadrant-2 Improve
  quadrant-3 Reconsider
  quadrant-4 Maintain
  Project A: [0.75, 0.80]
  Project B: [0.25, 0.20]`;

export const alternateQuadrant = `quadrantChart
  title Alternatives
  x-axis Low Reach --> High Reach
  y-axis Low Impact --> High Impact
  quadrant-1 Expand
  quadrant-2 Improve
  quadrant-3 Reconsider
  quadrant-4 Maintain
  Option C: [0.20, 0.75]
  Option D: [0.80, 0.25]`;

// Confirmed lexical rejection by the installed Mermaid 11.17.2 parser.
export const invalidQuadrant = "quadrantChart\n  Broken: [0.75, not-a-number]";
export const escapedErrorQuadrant = 'quadrantChart\n  Broken: [0.75, <b id="quadrant-injection">bad</b>]';
export const nativeFlowchart = "flowchart LR\n  A[Idea] --> B[Result]";
export const quadrantLabels = ["Priorities", "Low Reach", "High Reach", "Low Impact", "High Impact",
  "Expand", "Improve", "Reconsider", "Maintain", "Project A", "Project B"];
export const alternateLabels = quadrantLabels.map((label) =>
  ({ Priorities: "Alternatives", "Project A": "Option C", "Project B": "Option D" })[label] ?? label);
