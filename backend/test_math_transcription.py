import io
import json
import os
import re
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from fastapi.testclient import TestClient

from backend.exams import extract_fixture
from backend.main import create_app
from backend.math_transcription import (
    DEFAULT_MODEL,
    FALLBACK_CLARIFICATION,
    SYSTEM_PROMPT,
    TranscriptionError,
    check,
    transcribe_math,
)


EXPRESSIONS = (
    ("X squared plus five X equals twelve", "x^2+5x=12", "x squared plus five x equals twelve"),
    (
        "V one minus V two, all divided by R one, plus V one divided by R two, equals zero",
        r"\frac{V_1-V_2}{R_1}+\frac{V_1}{R_2}=0",
        "Start fraction, numerator V sub one minus V sub two, denominator R sub one, end fraction, "
        "plus start fraction, numerator V sub one, denominator R sub two, end fraction, equals zero",
    ),
    (
        "Z equals R plus J omega L minus J divided by the product of omega and C",
        r"Z=R+j\omega L-\frac{j}{\omega C}",
        "Z equals R plus j omega L minus start fraction, numerator j, denominator omega times C, end fraction",
    ),
    (
        "Integral from zero to infinity of e to the power of negative x squared, d x",
        r"\int_0^\infty e^{-x^2}\,dx",
        "Integral from zero to infinity of e to the power start exponent negative x squared end exponent, d x",
    ),
    ("Two plus two equals five", "2+2=5", "two plus two equals five"),
    (
        "Start fraction, numerator one, denominator start fraction, numerator x plus one, "
        "denominator y, end fraction, end fraction",
        r"\frac{1}{\frac{x+1}{y}}",
        "Outer fraction, numerator one, denominator inner fraction with numerator x plus one and denominator y",
    ),
    (
        "First derivative of y with respect to x equals three x squared",
        r"\frac{dy}{dx}=3x^2",
        "Start fraction, numerator d y, denominator d x, end fraction, equals three x squared",
    ),
)
AMBIGUOUS = "X plus Y over Z"
ASSISTANCE = "Solve X squared plus five X equals twelve"
CLARIFICATION = "Is the numerator X plus Y, or only Y?"


def latex_key(latex):
    """Compare LaTeX by meaning-bearing characters, ignoring style-only differences."""
    latex = re.sub(r"\\mathrm\{([^}]*)\}", r"\1", latex)
    latex = re.sub(r"\\(?:left|right)\b|\\[,;!: ]", "", latex)
    return re.sub(r"[\s{}]", "", latex).lower()


def http_error(code, body=b""):
    return HTTPError("https://example.test", code, "error", None, io.BytesIO(body))


def provider_response(result, finish_reason="stop"):
    return io.BytesIO(json.dumps({
        "choices": [{"finish_reason": finish_reason, "message": {"content": json.dumps(result)}}],
    }).encode())


class MathTranscriptionTests(unittest.TestCase):
    def test_success_examples_use_one_strict_transcript_only_request(self):
        for transcript, latex, spoken in EXPRESSIONS:
            with self.subTest(transcript=transcript):
                result = {"status": "ok", "latex": latex, "spoken": spoken, "clarification": None}
                with patch.dict(os.environ, {"GROQ_API_KEY": "test-key", "GROQ_MODEL": ""}), \
                        patch("backend.math_transcription.urlopen", return_value=provider_response(result)) as provider:
                    self.assertEqual(transcribe_math(transcript), result)
                provider.assert_called_once()
                request = provider.call_args.args[0]
                payload = json.loads(request.data)
                self.assertEqual(payload["model"], DEFAULT_MODEL)
                self.assertEqual(payload["messages"], [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": transcript},
                ])
                self.assertNotIn("tools", payload)
                self.assertTrue(payload["response_format"]["json_schema"]["strict"])

    def test_request_sends_an_explicit_user_agent(self):
        # Groq's Cloudflare front end rejects urllib's default "Python-urllib/x.y"
        # User-Agent with HTTP 403 (error code 1010) before checking the key.
        result = {"status": "ok", "latex": "x+1", "spoken": "x plus one", "clarification": None}
        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}), \
                patch("backend.math_transcription.urlopen", return_value=provider_response(result)) as provider:
            transcribe_math("x plus one")
        user_agent = provider.call_args.args[0].get_header("User-agent")
        self.assertTrue(user_agent)
        self.assertNotIn("Python-urllib", user_agent)

    def test_ambiguity_and_a_fresh_clarified_dictation(self):
        ambiguous = {"status": "ambiguous", "latex": None, "spoken": None, "clarification": CLARIFICATION}
        ok = {"status": "ok", "latex": r"\frac{x+y}{z}", "spoken": "x plus y, all over z", "clarification": None}
        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key", "GROQ_MODEL": "configured-model"}), \
                patch("backend.math_transcription.urlopen", side_effect=[provider_response(ambiguous), provider_response(ok)]) as provider:
            self.assertEqual(transcribe_math(AMBIGUOUS), ambiguous)
            self.assertEqual(transcribe_math("X plus Y all over Z"), ok)
        payload = json.loads(provider.call_args.args[0].data)
        self.assertEqual(payload["model"], "configured-model")
        self.assertEqual(payload["messages"][1:], [{"role": "user", "content": "X plus Y all over Z"}])

    def test_rejection_does_not_forward_assistance_or_display_provider_text(self):
        rejected = {"status": "rejected", "latex": None, "spoken": None, "clarification": None}
        unsolicited = rejected | {"spoken": "Extra provider text", "latex": "x=10"}
        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}), \
                patch("backend.math_transcription.urlopen", return_value=provider_response(unsolicited)) as provider:
            self.assertEqual(transcribe_math(ASSISTANCE), rejected)
            provider.assert_not_called()
            self.assertEqual(transcribe_math("I want the answer to this problem"), rejected)

    def test_each_provider_failure_logs_a_specific_cause_for_the_operator(self):
        cases = (
            (http_error(401, b'{"error":{"message":"Invalid API Key"}}'), 503, "rejected GROQ_API_KEY"),
            (http_error(400), 503, "hidden character in GROQ_API_KEY"),
            (http_error(400, b'{"error":{"message":"json_schema not supported"}}'), 503, "json_schema not supported"),
            (http_error(403, b"error code: 1010"), 503, "network front end blocked"),
            (http_error(404), 503, "no model named"),
            (http_error(429, b'{"error":{"message":"Rate limit"}}'), 429, "rate limit"),
            (URLError("getaddrinfo failed"), 503, "Could not connect to Groq"),
        )
        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}):
            for failure, status, cause in cases:
                with self.subTest(cause=cause), patch("backend.math_transcription.urlopen", side_effect=failure), \
                        self.assertLogs("uvicorn.error", "WARNING") as logs:
                    with self.assertRaises(TranscriptionError) as raised:
                        transcribe_math("x plus one")
                self.assertEqual(raised.exception.status_code, status)
                self.assertIn(cause.lower(), " ".join(logs.output).lower())
                self.assertNotIn("test-key", " ".join(logs.output))
                self.assertNotIn("GROQ", str(raised.exception))  # students see no setup details

    def test_keys_with_hidden_characters_are_refused_before_any_call(self):
        for key in ("gsk_abc\x16", "gsk_ab c", "\x16"):
            with self.subTest(key=repr(key)), patch.dict(os.environ, {"GROQ_API_KEY": key}), \
                    patch("backend.math_transcription.urlopen") as provider, \
                    self.assertLogs("uvicorn.error", "WARNING") as logs:
                with self.assertRaises(TranscriptionError) as raised:
                    transcribe_math("x plus one")
                self.assertEqual(raised.exception.status_code, 503)
                provider.assert_not_called()
                self.assertIn("hidden character", " ".join(logs.output))

    def test_read_aloud_fields_never_contain_latex(self):
        latex_question = {"status": "ambiguous", "latex": None, "spoken": None,
                          "clarification": r"Did you mean \(X + \frac{Y}{Z}\)?"}
        latex_spoken = {"status": "ok", "latex": "x^2", "spoken": "x^2", "clarification": None}
        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}):
            with patch("backend.math_transcription.urlopen", return_value=provider_response(latex_question)):
                self.assertEqual(transcribe_math(AMBIGUOUS)["clarification"], FALLBACK_CLARIFICATION)
            with patch("backend.math_transcription.urlopen", return_value=provider_response(latex_spoken)), \
                    self.assertLogs("uvicorn.error", "WARNING"):
                with self.assertRaises(TranscriptionError) as raised:
                    transcribe_math("x squared")
            self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("plain English words only", SYSTEM_PROMPT)
        self.assertIn(r"\frac{dy}{dx}", SYSTEM_PROMPT)

    def test_health_reports_math_availability(self):
        for key, expected in (("", False), ("gsk_abc\x16", False), ("test-key", True)):
            with self.subTest(key=repr(key)), patch.dict(os.environ, {"GROQ_API_KEY": key}):
                health = TestClient(create_app(extractor=extract_fixture)).get("/api/health").json()
                self.assertIs(health["math_transcription"], expected)

    def test_setup_check_explains_problems_and_success(self):
        ok = {"status": "ok", "latex": "x^2+1", "spoken": "x squared plus one", "clarification": None}
        runs = (
            ({"GROQ_API_KEY": ""}, None, 1, "not set"),
            ({"GROQ_API_KEY": "gsk_test"}, http_error(401), 1, "rejected GROQ_API_KEY"),
            ({"GROQ_API_KEY": "gsk_test"}, provider_response(ok), 0, "OK. Groq returned ok"),
        )
        for env, response, code, message in runs:
            effect = response if isinstance(response, HTTPError) else None
            with self.subTest(message=message), patch.dict(os.environ, env), \
                    patch("backend.math_transcription.urlopen", side_effect=effect, return_value=response), \
                    patch("sys.stdout", new_callable=io.StringIO) as out:
                self.assertEqual(check(), code)
            self.assertIn(message, out.getvalue())
            self.assertNotIn("gsk_test", out.getvalue())

    def test_provider_errors_and_bad_responses(self):
        errors = (
            (HTTPError("https://example.test", 429, "rate limited", None, None), 429),
            (TimeoutError(), 504),
            (URLError(TimeoutError()), 504),
            (URLError("provider connection failed"), 503),
        )
        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}), self.assertLogs("uvicorn.error", "WARNING"):
            for failure, expected in errors:
                with self.subTest(failure=failure):
                    with patch("backend.math_transcription.urlopen", side_effect=failure) as provider:
                        with self.assertRaises(TranscriptionError) as raised:
                            transcribe_math("x plus one")
                    self.assertEqual(raised.exception.status_code, expected)
                    provider.assert_called_once()
            invalid_responses = (
                io.BytesIO(b"not-json"),
                provider_response({"status": "ok", "latex": "x", "spoken": None, "clarification": None}),
                provider_response({"status": "ambiguous", "latex": "x", "spoken": None, "clarification": "Which grouping?"}),
                provider_response({"status": "ok", "latex": "x", "spoken": "x", "clarification": None}, "length"),
            )
            for response in invalid_responses:
                with patch("backend.math_transcription.urlopen", return_value=response):
                    with self.assertRaises(TranscriptionError) as raised:
                        transcribe_math("x plus one")
                    self.assertEqual(raised.exception.status_code, 502)

    def test_missing_key(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": ""}), self.assertLogs("uvicorn.error", "WARNING"), \
                patch("backend.math_transcription.urlopen") as provider:
            with self.assertRaises(TranscriptionError) as raised:
                transcribe_math("x plus one")
        self.assertEqual(raised.exception.status_code, 503)
        provider.assert_not_called()

    def test_endpoint_preview_confirmation_replacement_and_submission(self):
        client = TestClient(create_app(extractor=extract_fixture))
        draft = client.post("/api/exams", files={"file": ("exam.pdf", b"%PDF-1.4 draft")}).json()
        exam_url = f"/api/exams/{draft['id']}"
        client.put(exam_url, json=draft | {"needs_review": False}).raise_for_status()
        client.post(f"{exam_url}/publish", json={"approved": True}).raise_for_status()
        session = client.post(f"{exam_url}/sessions", json={}).json()
        session_url = f"/api/sessions/{session['id']}"
        math_url = f"{session_url}/math-transcription"
        transcript, latex, spoken = EXPRESSIONS[4]
        math = {"latex": latex, "spoken": spoken}

        with patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}), \
                patch("backend.math_transcription.urlopen", return_value=provider_response({
                    "status": "ok", **math, "clarification": None,
                })) as provider:
            self.assertEqual(client.post("/api/sessions/missing/math-transcription", json={"transcript": transcript}).status_code, 404)
            self.assertEqual(client.post(math_url, json={"transcript": transcript, "question": "hidden"}).status_code, 400)
            self.assertEqual(client.post(math_url, json={"transcript": "  "}).status_code, 400)
            self.assertEqual(client.post(math_url, json={"transcript": transcript}).json()["latex"], latex)
            provider.assert_called_once()

        previewed = client.get(session_url).json()
        self.assertEqual(previewed["answers"], {})
        self.assertNotIn("math_answers", previewed)
        answer_url = f"{session_url}/answers/q2"
        saved = client.put(answer_url, json={"text": transcript, "math": math}).json()
        self.assertEqual(saved["answers"], {"q2": transcript})
        self.assertEqual(saved["math_answers"], {"q2": math})
        edited = client.put(answer_url, json={"text": "edited transcript"}).json()
        self.assertNotIn("math_answers", edited)
        client.post(f"{session_url}/submit", json={"confirmed": True}).raise_for_status()
        self.assertEqual(client.post(math_url, json={"transcript": transcript}).status_code, 409)


@unittest.skipUnless(
    os.getenv("TAMKEEN_TEST_LIVE_GROQ") == "1" and os.getenv("GROQ_API_KEY"),
    "Live Groq requires TAMKEEN_TEST_LIVE_GROQ=1 and GROQ_API_KEY",
)
class LiveMathTranscriptionTests(unittest.TestCase):
    def test_live_synthetic_expressions(self):
        for transcript, expected, _ in EXPRESSIONS:
            with self.subTest(transcript=transcript):
                result = transcribe_math(transcript)
                self.assertEqual(result["status"], "ok")
                self.assertEqual(latex_key(result["latex"]), latex_key(expected), result["latex"])
                self.assertNotRegex(result["spoken"], r"[\\$]")

    def test_live_ambiguous_and_rejected(self):
        ambiguous = transcribe_math(AMBIGUOUS)
        self.assertEqual(ambiguous["status"], "ambiguous")
        self.assertTrue(ambiguous["clarification"])
        self.assertNotRegex(ambiguous["clarification"], r"[\\$]")
        self.assertIsNone(ambiguous["latex"])
        self.assertEqual(transcribe_math(ASSISTANCE), {
            "status": "rejected", "latex": None, "spoken": None, "clarification": None,
        })
