// Copy of fixtures/demo_exam.json (synthetic) for the Chrome test page, because
// the Vite dev server cannot serve files outside frontend/. Question 3 can use
// any test circuit so the page can exercise larger diagrams.
import type { Diagram, Exam } from '../../../../contracts/types';

export function buildDemoExam(q3Diagram: Diagram): Exam {
  return {
    id: 'demo',
    title: 'Sample STEM examination',
    status: 'published',
    needs_review: false,
    warnings: [],
    questions: [
      {
        id: 'q1',
        type: 'mcq',
        text: 'Which number is prime?',
        accessible_text: 'Which number is prime?',
        options: ['A. 9', 'B. 15', 'C. 17', 'D. 21'],
        diagram: null,
      },
      {
        id: 'q2',
        type: 'math',
        text: 'Find the derivative of f(x) = x² + 3x − 5.',
        accessible_text: 'Find the derivative of f of x equals x squared plus three x minus five.',
        options: [],
        diagram: null,
      },
      {
        id: 'q3',
        type: 'diagram',
        text: 'Find the current through R2.',
        accessible_text:
          'Find the current through resistor R2. Explore the circuit for component values and terminal connections.',
        options: [],
        diagram: q3Diagram,
      },
    ],
  };
}
