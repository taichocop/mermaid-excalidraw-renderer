export const samples = {
  flowchart: "flowchart TD\nA[Start] --> B{OK?}\nB -->|Yes| C[Done]\nB -->|No| D[Retry]\nD --> B",
  sequence: "sequenceDiagram\nAlice->>Bob: Hello Bob\nBob-->>Alice: Hello Alice",
  class: "classDiagram\nclass User {\n  +String name\n  +login()\n}",
  er: "erDiagram\nUSER ||--o{ POST : writes",
  state: "stateDiagram-v2\n[*] --> Idle\nIdle --> Active\nActive --> [*]",
  gantt: "gantt\n title Project\n dateFormat YYYY-MM-DD\n section Build\n Implement :a1, 2026-10-07, 2d",
  pie: "pie title Usage\n \"Work\" : 70\n \"Rest\" : 30",
  timeline: "timeline\n title History\n 2024 : Start\n 2025 : Release",
  invalid: "flowchart TD\nA -->",
} as const;
