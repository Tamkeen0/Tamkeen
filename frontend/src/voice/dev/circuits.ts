// Synthetic circuits for the developer test page only. No real exam data.
import type { Diagram } from '../../../../contracts/types';

export type TestCircuit = { id: string; label: string; diagram: Diagram };

export const TEST_CIRCUITS: TestCircuit[] = [
  {
    id: 'demo',
    label: 'Demo exam q3: V1, R1, R2 (fixture)',
    // Copy of fixtures/demo_exam.json question q3 (Vite cannot import files outside frontend/).
    diagram: {
      description: 'A circuit with a voltage source and two resistors. Nodes A, B, and C.',
      nodes: ['A', 'B', 'C'],
      components: [
        { id: 'V1', kind: 'voltage source', value: '12 V, positive at A, negative at C', terminals: ['A', 'C'] },
        { id: 'R1', kind: 'resistor', value: '2 ohms', terminals: ['A', 'B'] },
        { id: 'R2', kind: 'resistor', value: '4 ohms', terminals: ['B', 'C'] },
      ],
    },
  },
  {
    id: 'wide',
    label: 'Wide: four resistors, duplicate values, current source',
    diagram: {
      description: 'Synthetic test circuit with a voltage source, four resistors and a current source. Nodes A, B, C, and D.',
      nodes: ['A', 'B', 'C', 'D'],
      components: [
        { id: 'V1', kind: 'voltage source', value: '9 V, positive at A, negative at D', terminals: ['A', 'D'] },
        { id: 'R1', kind: 'resistor', value: '100 ohms', terminals: ['A', 'B'] },
        { id: 'R2', kind: 'resistor', value: '220 ohms', terminals: ['B', 'C'] },
        { id: 'R3', kind: 'resistor', value: '220 ohms', terminals: ['B', 'D'] },
        { id: 'R4', kind: 'resistor', value: '2.2 ohms', terminals: ['C', 'D'] },
        { id: 'I1', kind: 'current source', value: '3 mA, arrow from D to C', terminals: ['C', 'D'] },
      ],
    },
  },
  {
    id: 'current-source',
    label: 'Current source only: I1',
    diagram: {
      description: 'Synthetic test circuit with one current source. Nodes A and B.',
      nodes: ['A', 'B'],
      components: [{ id: 'I1', kind: 'current source', value: '3 mA, arrow from B to A', terminals: ['A', 'B'] }],
    },
  },
  {
    id: 'flip-flop',
    label: 'Flip-flop: Q1 (tests "queue" -> Q)',
    diagram: {
      description: 'Synthetic test diagram with one D flip-flop. Nodes D and CLK.',
      nodes: ['D', 'CLK'],
      components: [{ id: 'Q1', kind: 'flip-flop', value: 'D type, rising edge', terminals: ['D', 'CLK'] }],
    },
  },
];
