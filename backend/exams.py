"""Validate exam data against the shared schema and load document drafts."""

from collections.abc import Callable
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from . import ai_structuring
from .math_transcription import log

Exam = dict[str, Any]
Extractor = Callable[[bytes], Exam]

_ROOT = Path(__file__).resolve().parents[1]
_SCHEMA = json.loads((_ROOT / "contracts" / "exam.schema.json").read_text(encoding="utf-8"))
_VALIDATOR = Draft202012Validator(_SCHEMA)


class InvalidDraft(ValueError):
    """The exam fails schema validation or is incomplete for publication."""


def validate_draft(exam: Exam) -> None:
    error = next(_VALIDATOR.iter_errors(exam), None)
    if error is not None:
        field = ".".join(map(str, error.absolute_path)) or "exam"
        raise InvalidDraft(f"Invalid draft at {field}. Check the exam fields.")
    if exam["status"] != "draft":
        raise InvalidDraft("The exam must have draft status.")
    ids = {question["id"] for question in exam["questions"]}
    if len(ids) != len(exam["questions"]):
        raise InvalidDraft("Each question must have its own ID.")


def validate_for_publication(exam: Exam) -> None:
    for index, question in enumerate(exam["questions"], start=1):
        label = f"Question {index}"
        if question["type"] == "mcq" and not question["options"]:
            raise InvalidDraft(f"{label} needs its multiple-choice options.")

        diagram = question["diagram"]
        if question["type"] == "diagram" and (
            diagram is None or not diagram["nodes"] or not diagram["components"]
        ):
            raise InvalidDraft(f"{label} needs circuit nodes and components.")
        if diagram is None:
            continue

        nodes = set(diagram["nodes"])
        if len(nodes) != len(diagram["nodes"]):
            raise InvalidDraft(f"{label} has duplicate circuit nodes.")
        component_ids = {component["id"] for component in diagram["components"]}
        if len(component_ids) != len(diagram["components"]):
            raise InvalidDraft(f"{label} has duplicate circuit component IDs.")
        for component in diagram["components"]:
            if not nodes.issuperset(component["terminals"]):
                raise InvalidDraft(f"{label} has a component terminal that does not match a listed circuit node.")


class UnreadablePdf(ValueError):
    """The PDF itself cannot be used. The message tells the professor what to change."""


# Document-engine errors caused by the uploaded file, mapped to what the professor should do.
_PDF_PROBLEMS = (
    ("no digital text",
     "This PDF has a page with no selectable text, such as a scan or a photo. Upload a PDF exported from "
     "Word or Google Docs, or run text recognition (OCR) on the scan first."),
    ("No numbered questions",
     "No numbered questions were found. Start each question with a number such as \"1.\" or \"Question 1:\", "
     "put each choice on its own line such as \"A. ...\", and use a single-column layout."),
    ("encrypted, damaged, or empty",
     "The PDF is password-protected, damaged, or empty. Remove the password or export the PDF again."),
    ("Could not open the PDF", "The file could not be opened as a PDF. Export it again as a standard PDF."),
    ("Could not read the PDF pages", "The PDF's pages could not be read. Export it again as a standard PDF."),
    ("Could not extract text and figures",
     "The PDF's pages could not be read. Export it again as a standard PDF."),
    ("validate the extracted exam",
     "The questions were read but do not fit the supported layout: a single column, numbered questions, "
     "and lettered choices on their own lines. Adjust the layout and upload again."),
)


def extract_document(pdf_bytes: bytes) -> Exam:
    try:
        from document_engine import extract_exam
    except ImportError as error:
        raise RuntimeError("Document extraction is unavailable.") from error
    try:
        return extract_exam(pdf_bytes)
    except (ValueError, RuntimeError) as error:
        if "No numbered questions" in str(error) and ai_structuring.enabled():
            return _split_with_ai(pdf_bytes, error)
        for marker, explanation in _PDF_PROBLEMS:
            if marker in str(error):
                raise UnreadablePdf(explanation) from error
        raise


def _pdf_text(pdf_bytes: bytes) -> str:
    import pymupdf

    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as document:
        return "\n".join(page.get_text() for page in document)


def _split_with_ai(pdf_bytes: bytes, original: Exception) -> Exam:
    try:
        return ai_structuring.structure_exam(_pdf_text(pdf_bytes))
    except ai_structuring.TranscriptionError as failure:
        log.warning("AI question splitting failed: %s", failure.detail)
        explanation = dict(_PDF_PROBLEMS)["No numbered questions"]
        raise UnreadablePdf(f"{explanation} AI question splitting was also tried but failed.") from original


def extract_fixture(_pdf_bytes: bytes) -> Exam:
    exam = json.loads((_ROOT / "fixtures" / "demo_exam.json").read_text(encoding="utf-8"))
    exam["status"] = "draft"
    exam["needs_review"] = True
    exam["warnings"].append("Development fixture mode. This draft uses the demo fixture and no PDF content was extracted.")
    return exam
