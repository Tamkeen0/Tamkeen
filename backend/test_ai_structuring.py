"""AI question splitting for PDFs the rules cannot read, with a mocked Groq provider."""

import io
import json
import os
import sys
from types import ModuleType
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from fastapi.testclient import TestClient

from backend.ai_structuring import READ_BY_AI, SYSTEM_PROMPT
from backend.main import create_app

PDF = b"%PDF-1.4\n% synthetic\n%%EOF\n"
PDF_TEXT = """Physics Quiz - Spring
Answer all questions.
Q1 Which number is prime?
a) 9   b) 15   c) 17
Q2 Find the derivative of f(x) = x^2 + 3x - 5.
Q3 In the circuit shown, find the current through R2.
"""
SPLIT = {
    "title": "Physics Quiz - Spring",
    "questions": [
        {"type": "mcq", "text": "Which number is prime?", "options": ["a) 9", "b) 15", "c) 17"]},
        {"type": "math", "text": "Find the derivative of f(x) = x^2 + 3x - 5.", "options": []},
        {"type": "diagram", "text": "In the circuit shown, find the current through R2.", "options": []},
    ],
}


def groq_reply(content):
    return io.BytesIO(json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(content)}}]}).encode())


class AiStructuringTests(unittest.TestCase):
    def setUp(self):
        engine = ModuleType("document_engine")

        def no_numbered_questions(_pdf):
            raise RuntimeError("No numbered questions could be read. Use a digital PDF with numbered questions.")

        engine.extract_exam = no_numbered_questions
        self.enterContext(patch.dict(sys.modules, {"document_engine": engine}))
        self.enterContext(patch("backend.exams._pdf_text", return_value=PDF_TEXT))
        self.env = self.enterContext(patch.dict(os.environ, {
            "TAMKEEN_EXTRACTOR": "document", "TAMKEEN_AI_STRUCTURING": "1", "GROQ_API_KEY": "test-key"}))
        self.client = self.enterContext(TestClient(create_app()))

    def upload(self):
        return self.client.post("/api/exams", files={"file": ("quiz.pdf", PDF, "application/pdf")})

    def test_pdf_without_numbered_questions_becomes_a_reviewable_draft(self):
        with patch("backend.ai_structuring.urlopen", return_value=groq_reply(SPLIT)) as groq:
            response = self.upload()
        self.assertEqual(response.status_code, 201, response.text)
        draft = response.json()
        self.assertEqual(draft["title"], "Physics Quiz - Spring")
        self.assertEqual([q["type"] for q in draft["questions"]], ["mcq", "math", "diagram"])
        self.assertEqual(draft["questions"][0]["options"], ["a) 9", "b) 15", "c) 17"])
        self.assertTrue(draft["needs_review"])
        self.assertEqual(draft["warnings"][0], READ_BY_AI)
        self.assertTrue(any("q3" in w and "circuit" in w for w in draft["warnings"]))
        self.assertFalse(any("word for word" in w for w in draft["warnings"]))  # all text is verbatim

        request = groq.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["messages"], [{"role": "system", "content": SYSTEM_PROMPT},
                                               {"role": "user", "content": PDF_TEXT}])
        self.assertTrue(payload["response_format"]["json_schema"]["strict"])
        self.assertNotIn("Python-urllib", request.get_header("User-agent"))

    def test_reworded_text_is_flagged_for_the_professor(self):
        reworded = json.loads(json.dumps(SPLIT))
        reworded["questions"][1]["text"] = "Differentiate x squared plus 3x minus 5."
        with patch("backend.ai_structuring.urlopen", return_value=groq_reply(reworded)):
            warnings = self.upload().json()["warnings"]
        self.assertTrue(any(w.startswith("q2:") and "word for word" in w for w in warnings))
        self.assertFalse(any(w.startswith("q1:") and "word for word" in w for w in warnings))

    def test_only_questions_about_circuits_become_circuit_questions(self):
        guessed = {"title": "Quiz", "questions": [
            {"type": "diagram", "text": "Which number is prime?", "options": []},
            {"type": "diagram", "text": "Find the derivative of f(x) = x^2 + 3x - 5.", "options": []},
            {"type": "diagram", "text": "In the circuit shown, find the current through R2.", "options": []},
        ]}
        with patch("backend.ai_structuring.urlopen", return_value=groq_reply(guessed)):
            draft = self.upload().json()
        self.assertEqual([q["type"] for q in draft["questions"]], ["text", "math", "diagram"])
        circuit_warnings = [w for w in draft["warnings"] if "circuit" in w]
        self.assertEqual(len(circuit_warnings), 1)
        self.assertTrue(circuit_warnings[0].startswith("q3:"))
        self.assertIn("electrical circuit", SYSTEM_PROMPT)

    def test_setting_off_keeps_the_clear_formatting_message_and_sends_nothing(self):
        self.env["TAMKEEN_AI_STRUCTURING"] = "0"
        with patch("backend.ai_structuring.urlopen") as groq, self.assertLogs("uvicorn.error", "WARNING"):
            response = self.upload()
        groq.assert_not_called()
        self.assertEqual(response.status_code, 400)
        self.assertIn("No numbered questions", response.json()["detail"])
        self.assertNotIn("AI", response.json()["detail"])

    def test_groq_failure_explains_itself(self):
        failure = HTTPError("https://example.test", 401, "error", None, io.BytesIO(b'{"error":{"message":"Invalid API Key"}}'))
        with patch("backend.ai_structuring.urlopen", side_effect=failure), \
                self.assertLogs("uvicorn.error", "WARNING") as logs:
            response = self.upload()
        self.assertEqual(response.status_code, 400)
        self.assertIn("AI question splitting was also tried but failed", response.json()["detail"])
        self.assertIn("rejected GROQ_API_KEY", " ".join(logs.output))
        self.assertNotIn("test-key", " ".join(logs.output))

    def test_no_questions_found_by_ai_is_a_clear_rejection(self):
        with patch("backend.ai_structuring.urlopen", return_value=groq_reply({"title": "", "questions": []})), \
                self.assertLogs("uvicorn.error", "WARNING") as logs:
            response = self.upload()
        self.assertEqual(response.status_code, 400)
        self.assertIn("found no questions", " ".join(logs.output))


if __name__ == "__main__":
    unittest.main()
