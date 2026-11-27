"""Acceptance tests using an actual synthetic PDF and a mocked vision service."""

import base64
from io import BytesIO
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import URLError

from jsonschema import Draft202012Validator
import pymupdf

from document_engine import extract_exam

_ROOT = Path(__file__).resolve().parent.parent
_DEMO = json.loads((_ROOT / "fixtures" / "demo_exam.json").read_text(encoding="utf-8"))
_SCHEMA = json.loads((_ROOT / "contracts" / "exam.schema.json").read_text(encoding="utf-8"))
_CIRCUIT = _DEMO["questions"][2]["diagram"]
_ENV = {"AI_API_KEY": "synthetic-test-key", "AI_MODEL": "mock-vision"}


def _write(page, origin, text, font_size=12):
    writer = pymupdf.TextWriter(page.rect)
    writer.append(origin, text, font=pymupdf.Font("tiro"), fontsize=font_size)
    writer.write_text(page)


def _sample_pdf(*, diagram=True, equation=None, rotate=False):
    """Draw the fixture as a single-column, digital PDF with vector artwork."""
    with pymupdf.open() as doc:
        page = doc.new_page(width=500, height=500)
        _write(page, (42, 48), _DEMO["title"], 18)
        _write(page, (42, 85), "1. Which number is prime?")
        for y, option in zip((106, 126, 146, 166), _DEMO["questions"][0]["options"]):
            _write(page, (56, y), option)
        _write(page, (42, 200), "2. " + (equation or _DEMO["questions"][1]["text"]))
        if diagram:
            _write(page, (42, 240), "3. Find the current through R2.")
            page.draw_polyline([(120, 338), (120, 300), (176, 300)])
            page.draw_rect((176, 294, 214, 306))
            page.draw_line((214, 300), (310, 300))
            page.draw_line((310, 300), (310, 323))
            page.draw_rect((304, 323, 316, 361))
            page.draw_polyline([(310, 361), (310, 393), (120, 393), (120, 366)])
            page.draw_circle((120, 352), 14)
            _write(page, (108, 293), "A", 10)
            _write(page, (302, 293), "B", 10)
            _write(page, (109, 389), "C", 10)
            _write(page, (180, 290), "R1 2 ohms", 10)
            _write(page, (322, 346), "R2 4 ohms", 10)
            _write(page, (130, 373), "V1 12 V", 10)
            _write(page, (117, 349), "+", 9)
            _write(page, (118, 361), "−", 9)
        if rotate:
            page.set_rotation(90)
        return doc.tobytes()


def _model_response(data):
    return BytesIO(json.dumps({
        "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(data)}}],
    }).encode())


def _circuit_facts():
    return {field: _CIRCUIT[field] for field in ("nodes", "components")}


class DocumentEngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sample_pdf = _sample_pdf()

    def test_real_pdf_with_mocked_vision_provider(self):
        def mock_provider(request, timeout):
            payload = json.loads(request.data)
            self.assertEqual(payload["model"], _ENV["AI_MODEL"])
            self.assertEqual(payload["response_format"]["type"], "json_object")
            self.assertEqual(timeout, 20)
            prefix, encoded = payload["messages"][1]["content"][1]["image_url"]["url"].split(",", 1)
            self.assertEqual(prefix, "data:image/png;base64")
            image = pymupdf.Pixmap(base64.b64decode(encoded, validate=True))
            # This pixel-for-pixel check ties the provider input to the actual
            # source figure and ensures the request excludes the other questions.
            with pymupdf.open(stream=self.sample_pdf) as pdf:
                source_crop = pdf[0].get_pixmap(
                    matrix=pymupdf.Matrix(3, 3), clip=pymupdf.Rect(90, 277.4, 367.34, 409)
                )
            self.assertEqual((image.width, image.height), (source_crop.width, source_crop.height))
            self.assertEqual(image.samples, source_crop.samples)
            return _model_response(_circuit_facts())

        with patch.dict(os.environ, _ENV, clear=True), patch(
            "document_engine.circuit.urlopen", side_effect=mock_provider
        ) as provider:
            exam = extract_exam(self.sample_pdf)

        provider.assert_called_once()
        Draft202012Validator(_SCHEMA).validate(exam)
        self.assertEqual(exam["id"], "draft")
        self.assertEqual(exam["status"], "draft")
        self.assertEqual(exam["title"], _DEMO["title"])
        self.assertTrue(exam["needs_review"])
        self.assertIn("Verify every circuit", exam["warnings"][0])
        for observed, expected in zip(exam["questions"], _DEMO["questions"], strict=True):
            for key in ("id", "type", "text", "options"):
                self.assertEqual(observed[key], expected[key], key)
        math = exam["questions"][1]["accessible_text"]
        self.assertEqual(
            math,
            "Find the derivative of f open parenthesis x close parenthesis equals "
            "x squared plus 3 x minus 5.",
        )
        result = exam["questions"][2]["diagram"]
        self.assertEqual(result["nodes"], _CIRCUIT["nodes"])
        self.assertEqual(result["components"], _CIRCUIT["components"])

    def test_unconfigured_provider_returns_a_draft_requiring_review(self):
        with patch.dict(os.environ, {}, clear=True), patch("document_engine.circuit.urlopen") as provider:
            exam = extract_exam(self.sample_pdf)
        provider.assert_not_called()
        self.assertTrue(exam["needs_review"])
        self.assertIsNone(exam["questions"][2]["diagram"])
        self.assertIn("provider is unavailable", exam["warnings"][0])
        self.assertEqual(exam["questions"][2]["text"], _DEMO["questions"][2]["text"])

    def test_provider_connection_failure_preserves_local_extraction(self):
        with patch.dict(os.environ, _ENV, clear=True), patch(
            "document_engine.circuit.urlopen", side_effect=URLError("private request details")
        ):
            exam = extract_exam(self.sample_pdf)
        self.assertTrue(exam["needs_review"])
        self.assertIsNone(exam["questions"][2]["diagram"])
        self.assertIn("provider request failed", exam["warnings"][0])
        self.assertNotIn("private request details", exam["warnings"][0])
        self.assertEqual(exam["questions"][0]["options"], _DEMO["questions"][0]["options"])

    def test_rejects_invalid_or_leading_model_content(self):
        payloads = [
            {"nodes": [], "components": []},
            {**_circuit_facts(), "answer": "Solve the problem"},
            {"nodes": ["A", "B"], "components": [_CIRCUIT["components"][0]]},
            {
                "nodes": ["A", "B"],
                "components": [{"id": "R1", "kind": "resistor", "value": "Hint: use Ohm's law",
                                "terminals": ["A", "B"]}],
            },
        ]
        for payload in payloads:
            with self.subTest(payload=payload), patch.dict(os.environ, _ENV, clear=True), patch(
                "document_engine.circuit.urlopen", return_value=_model_response(payload)
            ):
                exam = extract_exam(self.sample_pdf)
                self.assertTrue(exam["needs_review"])
                self.assertIsNone(exam["questions"][2]["diagram"])

    def test_invalid_pdf_raises_value_error(self):
        for payload in (b"not a pdf", b"%PDF-1.7\ninvalid file", self.sample_pdf[:200]):
            with self.subTest(payload=payload[:15]), self.assertRaises(ValueError):
                extract_exam(payload)

    def test_no_digital_text_raises_runtime_error(self):
        with pymupdf.open() as pdf:
            pdf.new_page().draw_rect((30, 30, 90, 90))
            payload = pdf.tobytes()
        with self.assertRaisesRegex(RuntimeError, "no digital text"):
            extract_exam(payload)

    def test_text_and_basic_math_are_extracted_without_provider(self):
        with patch("document_engine.circuit.urlopen") as provider:
            exam = extract_exam(_sample_pdf(diagram=False))
        provider.assert_not_called()
        self.assertFalse(exam["needs_review"])
        self.assertEqual(exam["warnings"], [])

    def test_complex_math_preserves_source_for_manual_reading(self):
        for expression in ("Compare 1/(x + 2) and 1/x.", "Evaluate x^2.5."):
            with self.subTest(expression=expression):
                exam = extract_exam(_sample_pdf(diagram=False, equation=expression))
                self.assertTrue(exam["needs_review"])
                self.assertEqual(exam["questions"][1]["text"], expression)
                self.assertEqual(exam["questions"][1]["accessible_text"], expression)

    def test_rotated_page_preserves_figure_and_question_coordinates(self):
        with patch.dict(os.environ, {}, clear=True):
            exam = extract_exam(_sample_pdf(rotate=True))
        self.assertEqual(exam["questions"][2]["text"], _DEMO["questions"][2]["text"])
        self.assertIn("provider is unavailable", exam["warnings"][0])

    def test_embedded_circuit_image_is_sent_to_provider(self):
        with pymupdf.open(stream=self.sample_pdf) as source:
            figure = source[0].get_pixmap(clip=pymupdf.Rect(90, 270, 375, 415))
            with pymupdf.open() as pdf:
                page = pdf.new_page()
                _write(page, (42, 48), "Embedded circuit exam")
                _write(page, (42, 85), "1. Find the current through R2.")
                page.insert_image((80, 120, 365, 265), pixmap=figure)
                payload = pdf.tobytes()

        with patch.dict(os.environ, _ENV, clear=True), patch(
            "document_engine.circuit.urlopen", return_value=_model_response(_circuit_facts())
        ) as provider:
            exam = extract_exam(payload)
        provider.assert_called_once()
        self.assertEqual(exam["questions"][0]["text"], _DEMO["questions"][2]["text"])
        self.assertEqual(exam["questions"][0]["diagram"]["components"], _CIRCUIT["components"])
