"""Professor-side fallback: split a PDF's text into questions with Groq when the rules find none.

Off unless TAMKEEN_AI_STRUCTURING=1, because the unpublished exam text is sent to Groq.
The AI only copies and splits text; every question and choice is compared word for word with
the PDF, and the professor still reviews and approves the whole draft before publication.
"""

import json
import os
import re
import unicodedata
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .math_transcription import (
    GROQ_URL,
    USER_AGENT,
    TranscriptionError,
    _http_failure,
    key_problem,
    model_name,
)

MAX_TEXT = 30_000
# Same circuit test as the document engine's rules: only circuit questions get circuit facts.
_CIRCUIT = re.compile(r"\b(circuit|resistors?|voltage sources?)\b|\b[RV]\d+\b", re.IGNORECASE)
_MATH = re.compile(r"[=+−×÷√∑∫∞≤≥≠±²³^_]|\b\d+\s*[-/]\s*\d+\b")
READ_BY_AI = ("No numbered questions were recognised, so AI split this PDF into questions. "
              "Check every question and choice against the PDF before approving.")

SYSTEM_PROMPT = """You split the text of an exam into its questions so a professor can review them.

Strict rules:
- Copy the title, every question and every answer choice exactly as written in the input,
  character for character. Never reword, correct, summarise, translate, or complete text.
- Never solve questions. Never add answers, hints, or explanations.
- A question's text is its full prompt without its number or label.
- Each answer choice keeps its own label exactly as written, for example "A. 9" or "(b) 15".
- Leave out general instructions, headers, footers, and page numbers.
- type is "mcq" when the question has answer choices, "diagram" only when it asks about an
  electrical circuit, "math" when it asks for a mathematical expression or calculation,
  otherwise "text". Graphs, tables, and other figures are not "diagram".
- If the text has no title, use an empty string.

Return only JSON matching the schema."""

_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "questions"],
    "properties": {
        "title": {"type": "string"},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "text", "options"],
                "properties": {
                    "type": {"type": "string", "enum": ["mcq", "text", "math", "diagram"]},
                    "text": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}


def enabled() -> bool:
    return os.getenv("TAMKEEN_AI_STRUCTURING", "").strip() == "1" and \
        key_problem(os.getenv("GROQ_API_KEY", "").strip()) is None


def status_line() -> str:
    if os.getenv("TAMKEEN_AI_STRUCTURING", "").strip() != "1":
        return "AI question splitting is off (set TAMKEEN_AI_STRUCTURING=1 to read PDFs without numbered questions)."
    problem = key_problem(os.getenv("GROQ_API_KEY", "").strip())
    if problem:
        return f"AI question splitting is off. {problem}"
    return f"AI question splitting is on for PDFs without numbered questions (Groq model {model_name()})."


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()


def _call_groq(text: str) -> dict[str, Any]:
    payload = {
        "model": model_name(),
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": text}],
        "reasoning_effort": "low",
        "max_completion_tokens": 8192,
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": "exam_questions", "strict": True, "schema": _SCHEMA}},
    }
    request = Request(GROQ_URL, data=json.dumps(payload).encode("utf-8"), method="POST", headers={
        "Authorization": f"Bearer {os.environ['GROQ_API_KEY'].strip()}",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    })
    try:
        with urlopen(request, timeout=60) as response:
            completion = json.loads(response.read(2_000_000))
    except HTTPError as error:
        raise _http_failure(error) from error
    except (URLError, TimeoutError, OSError) as error:
        raise TranscriptionError(503, "AI question splitting is unavailable.", f"Could not reach Groq: {error}.") from error
    except ValueError as error:
        raise TranscriptionError(502, "AI question splitting failed.", "Groq's reply was not valid JSON.") from error
    try:
        choice = completion["choices"][0]
        if choice["finish_reason"] != "stop":
            raise ValueError(f"incomplete reply (finish_reason={choice['finish_reason']})")
        return json.loads(choice["message"]["content"])
    except (IndexError, KeyError, TypeError, ValueError) as error:
        raise TranscriptionError(502, "AI question splitting failed.", f"Groq's reply was unusable: {error}.") from error


def structure_exam(text: str) -> dict[str, Any]:
    """Return a draft Exam built from the PDF text, or raise TranscriptionError."""
    if not text.strip():
        raise TranscriptionError(400, "The PDF has no text.", "The PDF has no text to split.")
    if len(text) > MAX_TEXT:
        raise TranscriptionError(413, "The PDF is too long.", f"The PDF text is over {MAX_TEXT} characters.")

    data = _call_groq(text)
    source = _normalized(text)
    warnings = [READ_BY_AI]
    questions = []
    for item in data.get("questions", []):
        prompt = item["text"].strip()
        if not prompt:
            continue
        number = len(questions) + 1
        options = [option.strip() for option in item["options"] if option.strip()]
        # Decide the type from the text itself rather than trusting the model's guess.
        if options:
            kind = "mcq"
        elif _CIRCUIT.search(prompt):
            kind = "diagram"
        elif item["type"] == "math" or _MATH.search(prompt):
            kind = "math"
        else:
            kind = "text"
        if any(_normalized(part) not in source for part in (prompt, *options)):
            warnings.append(f"q{number}: The AI's wording does not match the PDF word for word. "
                            "Correct it from the source before approving.")
        if kind == "diagram":
            warnings.append(f"q{number}: Enter the circuit facts manually from the PDF figure.")
        questions.append({"id": f"q{number}", "type": kind, "text": prompt, "accessible_text": prompt,
                          "options": options, "diagram": None})
    if not questions:
        raise TranscriptionError(422, "No questions were found.", "Groq found no questions in the PDF text.")
    return {"id": "draft", "title": data.get("title", "").strip() or "Untitled exam", "status": "draft",
            "needs_review": True, "warnings": warnings, "questions": questions}
