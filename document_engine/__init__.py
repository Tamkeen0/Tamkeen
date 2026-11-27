"""Convert a digital exam PDF into a professor-reviewable draft."""

import json
from pathlib import Path

from . import circuit
from .pdf import read_exam

__all__ = ["extract_exam"]

_SCHEMA = Path(__file__).resolve().parent.parent / "contracts" / "exam.schema.json"


def extract_exam(pdf_bytes: bytes) -> dict:
    """Return a schema-validated draft, or raise ValueError or RuntimeError."""
    if not isinstance(pdf_bytes, bytes) or not pdf_bytes.startswith(b"%PDF-"):
        raise ValueError("Expected bytes from a PDF file.")

    try:
        from jsonschema import Draft202012Validator
        from jsonschema.exceptions import ValidationError
    except ImportError as exc:
        raise RuntimeError("Exam schema validation requires jsonschema.") from exc

    draft = read_exam(pdf_bytes, circuit.extract)
    try:
        schema = json.loads(_SCHEMA.read_text(encoding="utf-8"))
        Draft202012Validator(schema).validate(draft)
    except (OSError, ValueError, ValidationError) as exc:
        raise RuntimeError("Could not validate the extracted exam against the shared schema.") from exc
    return draft
