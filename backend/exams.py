"""Validate exam data against the shared schema and load document drafts."""

from collections.abc import Callable
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

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


def extract_document(pdf_bytes: bytes) -> Exam:
    try:
        from document_engine import extract_exam
    except ImportError as error:
        raise RuntimeError("Document extraction is unavailable.") from error
    return extract_exam(pdf_bytes)


def extract_fixture(_pdf_bytes: bytes) -> Exam:
    exam = json.loads((_ROOT / "fixtures" / "demo_exam.json").read_text(encoding="utf-8"))
    exam["status"] = "draft"
    exam["needs_review"] = True
    exam["warnings"].append("Development fixture mode. This draft uses the demo fixture and no PDF content was extracted.")
    return exam
