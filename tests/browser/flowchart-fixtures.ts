export const directions = ["TD", "TB", "BT", "LR", "RL"] as const;
export const syntaxes = ["flowchart", "graph"] as const;
export const directionFixture = (syntax: typeof syntaxes[number], direction: typeof directions[number]) =>
  `${syntax} ${direction}\n A[Input] -->|Next| B[Process]\n B --> C[Output]`;
export const invisible = 'flowchart LR\n A["Input"] ~~~ B["Layout only"]\n A --> C["Output"]';
export const invisibleControl = 'flowchart LR\n A["Input"]\n B["Layout only"]\n A --> C["Output"]';
export const edges = [
  { name: "arrow", syntax: "-->", style: "solid", width: 2, start: null, end: "arrow", label: null },
  { name: "line", syntax: "---", style: "solid", width: 2, start: null, end: null, label: null },
  { name: "dashed", syntax: "-.->", style: "dashed", width: 2, start: null, end: "arrow", label: null },
  { name: "thick", syntax: "==>", style: "solid", width: 4, start: null, end: "arrow", label: null },
  { name: "labelled", syntax: "-->|Yes|", style: "solid", width: 2, start: null, end: "arrow", label: "Yes" },
  { name: "bidirectional", syntax: "<-->", style: "solid", width: 2, start: "arrow", end: "arrow", label: null },
] as const;
export const edgeFixture = (syntax: string) => `flowchart LR\n A[Source] ${syntax} B[Target]`;
export const shapes = 'flowchart LR\n A[Rectangle] --> B(Rounded)\n B --> C((Circle))\n C --> D{Diamond}';
export const basicSubgraph = 'flowchart TB\n subgraph Group[Basic group]\n  A[Alpha] --> B[Beta]\n end';
export const nestedSubgraph = `flowchart TB
 subgraph Outer
  direction LR
  A[Alpha] --> B[Beta]
  subgraph Inner
   C[Gamma] --- D[Delta]
  end
 end`;
export const directedSubgraph = `flowchart TB
 subgraph Group[Internal LR]
  direction LR
  A[Alpha] --> B[Beta]
 end`;
export const externallyConnectedSubgraph = `flowchart TB
 subgraph Group[External connection]
  direction LR
  A[Alpha] --> B[Beta]
 end
 B --> C[Outside]`;
export const invalid = 'flowchart LR\n A["<b id=flowchart-injection>Unsafe</b>"] -->';
export const allFixtures = [
 ...syntaxes.flatMap(syntax => directions.map(direction => ({ name: `${syntax}-${direction}`, source: directionFixture(syntax, direction) }))),
 { name: "invisible", source: invisible }, { name: "invisible-control", source: invisibleControl },
 ...edges.map(edge => ({ name: `edge-${edge.name}`, source: edgeFixture(edge.syntax) })),
 { name: "shapes", source: shapes }, { name: "subgraph-basic", source: basicSubgraph },
 { name: "subgraph-nested", source: nestedSubgraph }, { name: "subgraph-direction", source: directedSubgraph },
 { name: "subgraph-external", source: externallyConnectedSubgraph }, { name: "invalid", source: invalid },
];
