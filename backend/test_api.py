"""Acceptance tests for the public API, using synthetic exam content."""

from copy import deepcopy
import json
import os
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch
from urllib.parse import quote

from fastapi.testclient import TestClient

from backend.main import MAX_PDF_BYTES, create_app

_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "demo_exam.json"
_PDF = b"%PDF-1.4\n% synthetic input for the test extractor\n%%EOF\n"


def sample_draft() -> dict:
    draft = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    draft["id"] = "temporary-document-id"
    draft["status"] = "draft"
    draft["needs_review"] = True
    draft["warnings"] = ["Check circuit labels against the source."]
    return draft


class ExamApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.extracted = sample_draft()
        self.extractor = Mock(return_value=self.extracted)
        self.client = self.enterContext(TestClient(create_app(extractor=self.extractor)))

    def upload(self, content: bytes = _PDF):
        return self.client.post("/api/exams", files={"file": ("synthetic.pdf", content, "application/pdf")})

    def draft(self) -> dict:
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def publish(self, draft: dict) -> dict:
        endpoint = f"/api/exams/{draft['id']}"
        draft["needs_review"] = False
        response = self.client.put(endpoint, json=draft)
        self.assertEqual(response.status_code, 200, response.text)
        response = self.client.post(f"{endpoint}/publish", json={"approved": True})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def start(self, exam_id: str) -> dict:
        response = self.client.post(f"/api/exams/{exam_id}/sessions", json={})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_health_and_server_assigned_id(self) -> None:
        self.assertEqual(self.client.get("/api/health").json(), {"ok": True})
        first, second = self.draft(), self.draft()
        self.assertNotEqual(first["id"], second["id"])
        self.assertNotEqual(first["id"], self.extracted["id"])
        self.assertEqual(first["questions"], self.extracted["questions"])
        self.assertEqual(self.client.get(f"/api/exams/{first['id']}").json(), first)
        self.extractor.assert_called_with(_PDF)

    def test_exam_ids_are_short_codes_without_look_alike_characters(self) -> None:
        ids = {self.draft()["id"] for _ in range(50)}
        self.assertEqual(len(ids), 50)
        for exam_id in ids:
            self.assertRegex(exam_id, r"^[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{6}$")

    def test_exam_code_collisions_are_retried(self) -> None:
        with patch("backend.store.secrets.choice", side_effect=list("AAAAAA" "AAAAAA" "BBBBBB")):
            first, second = self.draft(), self.draft()
        self.assertEqual((first["id"], second["id"]), ("AAAAAA", "BBBBBB"))

    def test_exam_codes_ignore_case_and_surrounding_spaces(self) -> None:
        exam = self.publish(self.draft())
        typed = quote(f"  {exam['id'].lower()} ")
        self.assertEqual(self.client.get(f"/api/exams/{typed}").json()["id"], exam["id"])
        session = self.start(typed)
        self.assertEqual(session["exam"]["id"], exam["id"])
        response = self.client.post(f"/api/sessions/{session['id']}/submit", json={"confirmed": True})
        self.assertEqual(response.status_code, 200, response.text)
        submissions = self.client.get(f"/api/exams/{typed}/submissions").json()["submissions"]
        self.assertEqual([item["id"] for item in submissions], [session["id"]])

    def test_draft_can_be_saved_through_a_lowercase_code(self) -> None:
        draft = self.draft()
        response = self.client.put(f"/api/exams/{draft['id'].lower()}", json=draft)
        self.assertEqual(response.status_code, 200, response.text)

    def test_bad_uploads_are_rejected_before_extraction(self) -> None:
        self.assertEqual(self.client.post("/api/exams").status_code, 400)
        self.assertEqual(self.upload(b"not a PDF").status_code, 400)
        self.assertEqual(self.upload(b"").status_code, 400)
        self.assertEqual(self.upload(b"%PDF-" + b"x" * MAX_PDF_BYTES).status_code, 413)
        self.extractor.assert_not_called()

    def test_extraction_errors_are_reported_without_provider_details(self) -> None:
        for error, status in [(ValueError("test detail"), 400), (RuntimeError("test detail"), 503)]:
            with self.subTest(error=type(error)):
                self.extractor.side_effect = error
                response = self.upload()
                self.assertEqual(response.status_code, status)
                self.assertNotIn("test detail", response.json()["detail"])

    def test_nonconforming_engine_response_is_rejected(self) -> None:
        self.extracted["questions"][0]["correct_answer"] = "Test-only extra field."
        response = self.upload()
        self.assertEqual(response.status_code, 502)
        self.assertIn("invalid exam draft", response.json()["detail"])

    def test_unresolved_draft_and_explicit_approval(self) -> None:
        draft = self.draft()
        endpoint = f"/api/exams/{draft['id']}"
        self.assertEqual(self.client.post(f"{endpoint}/sessions", json={}).status_code, 409)
        self.assertEqual(self.client.post(f"{endpoint}/publish", json={"approved": True}).status_code, 409)
        for body in ({}, {"approved": False}, {"approved": 1}, {"approved": "true"}):
            with self.subTest(body=body):
                self.assertEqual(self.client.post(f"{endpoint}/publish", json=body).status_code, 400)
        self.assertEqual(self.client.get(endpoint).json(), draft)

    def test_draft_update_checks_shape_and_ids(self) -> None:
        draft = self.draft()
        endpoint = f"/api/exams/{draft['id']}"
        duplicate = deepcopy(draft)
        duplicate["questions"][1]["id"] = duplicate["questions"][0]["id"]
        for body in (
            {**draft, "id": "different-id"},
            {**draft, "status": "published"},
            {**draft, "needs_review": "false"},
            {**draft, "questions": []},
            duplicate,
        ):
            with self.subTest(body=body):
                self.assertEqual(self.client.put(endpoint, json=body).status_code, 400)
                self.assertEqual(self.client.get(endpoint).json(), draft)

    def test_draft_with_invalid_terminal_cannot_be_published(self) -> None:
        draft = self.draft()
        endpoint = f"/api/exams/{draft['id']}"
        diagram = draft["questions"][2]["diagram"]
        diagram["components"][0]["terminals"][0] = "unlisted-node"
        draft["needs_review"] = False

        self.assertEqual(self.client.put(endpoint, json=draft).status_code, 200)
        response = self.client.post(f"{endpoint}/publish", json={"approved": True})
        self.assertEqual(response.status_code, 409)
        self.assertIn("component terminal", response.json()["detail"])
        self.assertEqual(self.client.get(endpoint).json()["status"], "draft")

        diagram["components"][0]["terminals"][0] = "A"
        self.assertEqual(self.publish(draft)["status"], "published")

    def test_other_incomplete_circuit_and_choice_data(self) -> None:
        for defect in ("missing diagram", "missing options", "duplicate nodes", "duplicate component IDs"):
            with self.subTest(defect=defect):
                draft = self.draft()
                draft["needs_review"] = False
                diagram = draft["questions"][2]["diagram"]
                if defect == "missing diagram":
                    draft["questions"][2]["diagram"] = None
                elif defect == "missing options":
                    draft["questions"][0]["options"] = []
                elif defect == "duplicate nodes":
                    diagram["nodes"].append(diagram["nodes"][0])
                else:
                    diagram["components"].append(deepcopy(diagram["components"][0]))
                endpoint = f"/api/exams/{draft['id']}"
                self.assertEqual(self.client.put(endpoint, json=draft).status_code, 200)
                self.assertEqual(self.client.post(f"{endpoint}/publish", json={"approved": True}).status_code, 409)

    def test_published_exams_cannot_be_edited_or_published_again(self) -> None:
        draft = self.draft()
        self.publish(draft)
        endpoint = f"/api/exams/{draft['id']}"
        self.assertEqual(self.client.put(endpoint, json=draft).status_code, 409)
        self.assertEqual(self.client.post(f"{endpoint}/publish", json={"approved": True}).status_code, 409)

    def test_complete_flow_preserves_literal_answers_and_filters_results(self) -> None:
        draft = self.draft()
        draft["questions"][0]["accessible_text"] = "Which listed number is prime?"
        exam = self.publish(draft)
        participant = self.start(draft["id"])
        other = self.start(draft["id"])
        second_exam = self.publish(self.draft())
        second_participant = self.start(second_exam["id"])
        result_url = f"/api/exams/{draft['id']}/submissions"
        session_url = f"/api/sessions/{participant['id']}"

        self.assertEqual(exam["warnings"], self.extracted["warnings"])
        self.assertEqual(participant["exam"], {**exam, "warnings": []})
        self.assertNotEqual(other["id"], participant["id"])
        self.assertEqual(self.client.get(result_url).json(), {"submissions": []})
        text = "  x² + 3·β\nLiteral dictated phrase: submit.  "
        endpoint = f"{session_url}/answers/q1"
        for answer in ("first version", text, text):
            response = self.client.put(endpoint, json={"text": answer})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["answers"], {"q1": answer})
        self.assertEqual(self.client.get(f"/api/sessions/{other['id']}").json()["answers"], {})

        response = self.client.post(f"{session_url}/submit", json={"confirmed": True})
        self.assertEqual(response.status_code, 200)
        submitted = response.json()
        self.assertEqual(submitted["status"], "submitted")
        self.assertEqual(submitted["answers"], {"q1": text})
        self.assertEqual(self.client.get(session_url).json(), submitted)
        self.assertEqual(
            self.client.post(f"/api/sessions/{second_participant['id']}/submit", json={"confirmed": True}).status_code,
            200,
        )
        self.assertEqual(self.client.get(result_url).json(), {"submissions": [submitted]})
        self.assertEqual(self.client.put(endpoint, json={"text": "late edit"}).status_code, 409)
        self.assertEqual(self.client.post(f"{session_url}/submit", json={"confirmed": True}).status_code, 409)
        self.assertEqual(self.client.get(session_url).json(), submitted)

    def test_explicit_submission_and_answer_validation(self) -> None:
        session = self.start(self.publish(self.draft())["id"])
        endpoint = f"/api/sessions/{session['id']}"
        for payload in ({"confirmed": False}, {"confirmed": "true"}, {}):
            self.assertEqual(self.client.post(f"{endpoint}/submit", json=payload).status_code, 400)
        for payload in ({"text": None}, {"text": 2}, {}):
            self.assertEqual(self.client.put(f"{endpoint}/answers/q1", json=payload).status_code, 400)
        self.assertEqual(self.client.put(f"{endpoint}/answers/unknown", json={"text": "x"}).status_code, 404)
        self.assertEqual(self.client.get(endpoint).json(), session)
        self.assertEqual(self.client.post(f"{endpoint}/submit", json={"confirmed": True}).json()["answers"], {})

    def test_unknown_ids_and_malformed_requests(self) -> None:
        self.assertEqual(self.client.get("/api/exams/unknown").status_code, 404)
        self.assertEqual(self.client.get("/api/sessions/unknown").status_code, 404)
        self.assertEqual(self.client.post("/api/exams/unknown/sessions", json={}).status_code, 404)
        self.assertEqual(self.client.get("/api/exams/unknown/submissions").status_code, 404)
        response = self.client.post(
            "/api/exams/unknown/sessions", content="{", headers={"Content-Type": "application/json"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIsInstance(response.json()["detail"][0]["msg"], str)

    def test_string_question_ids_can_include_path_characters(self) -> None:
        draft = self.draft()
        question_id = "resistor/A?β"
        draft["questions"][0]["id"] = question_id
        session = self.start(self.publish(draft)["id"])
        response = self.client.put(
            f"/api/sessions/{session['id']}/answers/{quote(question_id, safe='')}", json={"text": "literal"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answers"], {question_id: "literal"})

    def test_extractor_configuration_selects_fixture_explicitly(self) -> None:
        with patch.dict(os.environ, {"TAMKEEN_EXTRACTOR": "fixture"}):
            app = create_app()
        with TestClient(app) as client:
            response = client.post("/api/exams", files={"file": ("demo.pdf", _PDF, "application/pdf")})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["needs_review"])
        self.assertIn("Development fixture mode", response.json()["warnings"][0])

    def test_production_adapter_uses_document_interface(self) -> None:
        engine = ModuleType("document_engine")
        engine.extract_exam = self.extractor
        with patch.dict(os.environ, {"TAMKEEN_EXTRACTOR": "document"}):
            app = create_app()
        with patch.dict(sys.modules, {"document_engine": engine}), TestClient(app) as client:
            response = client.post("/api/exams", files={"file": ("demo.pdf", _PDF, "application/pdf")})
            self.assertEqual(response.status_code, 201)
            self.extractor.assert_called_once_with(_PDF)
        with patch.dict(sys.modules, {"document_engine": None}), TestClient(app) as client:
            response = client.post("/api/exams", files={"file": ("demo.pdf", _PDF, "application/pdf")})
            self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
