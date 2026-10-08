export const samples = {
  flowchart: "flowchart TD\nA[Start] --> B{OK?}\nB -->|Yes| C[Done]\nB -->|No| D[Retry]\nD --> B",
  sequence: "sequenceDiagram\nAlice->>Bob: Hello Bob\nBob-->>Alice: Hello Alice",
  class: "classDiagram\nclass User {\n  +String name\n  +login()\n}",
  er: "erDiagram\nUSER ||--o{ POST : writes",
  state: "stateDiagram-v2\n[*] --> Idle\nIdle --> Active\nActive --> [*]",
  gantt: "gantt\n title Project\n dateFormat YYYY-MM-DD\n section Build\n Implement :a1, 2026-10-07, 2d",
  pie: "pie title Usage\n \"Work\" : 70\n \"Rest\" : 30",
  timeline: "timeline\n title History\n 2024 : Start\n 2025 : Release",
  blockSimple: 'block-beta\n  columns 3\n  A["Client"]\n  B["API"]\n  C["Database"]',
  blockArrows: 'block-beta\n  columns 3\n  A["Client"]\n  B["API"]\n  C["Database"]\n  A --> B\n  B --> C',
  blockColumns: 'block-beta\n  columns 3\n  A["A"]:2\n  B["B"]\n  C["C"]\n  D["D"]:2',
  // Official Composite Blocks / Column Width Dynamics example, using block-beta.
  blockNested: "block-beta\n  columns 3\n  a:3\n  block:group1:2\n    columns 2\n    h i j k\n  end\n  g\n  block:group2:3\n    l m n o p q r\n  end",
  blockInvalid: "block-beta\n  columns 2\n  A -->",
  invalid: "flowchart TD\nA -->",
} as const;
