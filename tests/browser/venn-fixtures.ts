export const twoSets = `venn-beta
  set A
  set B
  union A,B`;

export const labeled = `venn-beta
  title "Team Skills"
  set Frontend["Frontend"]
  set Backend["Backend"]
  union Frontend,Backend["Fullstack"]`;

export const threeSets = `venn-beta
  title "Feature Triangle"
  set Desirable
  set Feasible
  set Viable
  union Desirable,Feasible["Buildable"]
  union Feasible,Viable["Sustainable"]
  union Desirable,Viable["Marketable"]
  union Desirable,Feasible,Viable["Innovation"]`;

export const sized = `venn-beta
  set A["Alpha"]:20
  set B["Beta"]:12
  union A,B["Shared"]:3`;

export const textNodes = `venn-beta
  set A["Frontend"]
    text A1["React"]
    text A2["Design Systems"]
  set B["Backend"]
    text B1["API"]
  union A,B["Shared"]
    text AB1["OpenAPI"]`;

export const invalidUnion = `venn-beta
  set A
  union A,B["Missing B"]`;
export const injectedError = 'venn-beta\n  set A\n  union A,B["<b id=venn-injection>Missing B</b>"]';
export const nativeFlow = "flowchart LR\n  A[Idea] --> B[Result]";

export const vennFixtures = [
  { name: "two-set", source: twoSets, sets: 2, labels: ["A", "B"] },
  { name: "title-labels", source: labeled, sets: 2, labels: ["Team Skills", "Frontend", "Backend", "Fullstack"] },
  { name: "three-set", source: threeSets, sets: 3,
    labels: ["Feature Triangle", "Desirable", "Feasible", "Viable", "Buildable", "Sustainable", "Marketable", "Innovation"] },
  { name: "sizes", source: sized, sets: 2, labels: ["Alpha", "Beta", "Shared"] },
  { name: "text-nodes", source: textNodes, sets: 2,
    labels: ["Frontend", "Backend", "Shared", "React", "Design Systems", "API", "OpenAPI"] },
] as const;
