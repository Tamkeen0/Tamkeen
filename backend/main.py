"""FastAPI implementation of contracts/API.md."""

import os
from typing import Annotated

from fastapi import APIRouter, Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr

from .exams import (
    Exam,
    Extractor,
    InvalidDraft,
    extract_document,
    extract_fixture,
    validate_draft,
)
from .store import ExamStore, Session, normalize_exam_id
from .math_transcription import MAX_OUTPUT, MAX_TRANSCRIPT, TranscriptionError, transcribe_math

MAX_PDF_BYTES = 10 * 1024 * 1024


class RequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PublishBody(RequestBody):
    approved: StrictBool


class StartBody(RequestBody):
    pass


class MathNotationBody(RequestBody):
    latex: Annotated[StrictStr, Field(min_length=1, max_length=MAX_OUTPUT)]
    spoken: Annotated[StrictStr, Field(min_length=1, max_length=MAX_OUTPUT)]


class AnswerBody(RequestBody):
    text: StrictStr
    math: MathNotationBody | None = None


class MathTranscriptionBody(RequestBody):
    transcript: Annotated[StrictStr, Field(min_length=1, max_length=MAX_TRANSCRIPT)]


class SubmitBody(RequestBody):
    confirmed: StrictBool


def create_app(*, extractor: Extractor | None = None) -> FastAPI:
    if extractor is None:
        mode = os.getenv("TAMKEEN_EXTRACTOR", "document")
        if mode == "document":
            extractor = extract_document
        elif mode == "fixture":
            extractor = extract_fixture
        else:
            raise ValueError("TAMKEEN_EXTRACTOR must be document or fixture.")

    app = FastAPI(title="Tamkeen")
    api = APIRouter(prefix="/api")
    store = ExamStore()

    @app.exception_handler(RequestValidationError)
    async def malformed_request(_request: Request, error: RequestValidationError) -> JSONResponse:
        detail = [
            {"loc": issue["loc"], "msg": issue["msg"], "type": issue["type"]}
            for issue in error.errors()
        ]
        return JSONResponse(status_code=400, content={"detail": detail})

    @api.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @api.post("/exams", status_code=201)
    def upload_exam(file: Annotated[UploadFile, File()]) -> Exam:
        with file.file as source:
            pdf = source.read(MAX_PDF_BYTES + 1)
        if len(pdf) > MAX_PDF_BYTES:
            raise HTTPException(413, "The exam PDF must be 10 MiB or smaller.")
        if not pdf.startswith(b"%PDF-"):
            raise HTTPException(400, "Choose a valid PDF file.")

        try:
            extracted = extractor(pdf)
        except ValueError as error:
            raise HTTPException(400, "The document engine could not read that PDF.") from error
        except RuntimeError as error:
            raise HTTPException(503, "Document extraction is unavailable. Check the document engine setup.") from error

        try:
            validate_draft(extracted)
        except InvalidDraft as error:
            raise HTTPException(502, "The document engine returned an invalid exam draft.") from error
        return store.create_draft(extracted)

    @api.get("/exams/{exam_id}")
    def get_exam(exam_id: str) -> Exam:
        return store.get_exam(exam_id)

    @api.put("/exams/{exam_id}")
    def save_draft(exam_id: str, draft: Annotated[Exam, Body()]) -> Exam:
        try:
            validate_draft(draft)
            if draft["id"] != normalize_exam_id(exam_id):
                raise InvalidDraft("The draft ID must match the exam ID in the URL.")
        except InvalidDraft as error:
            raise HTTPException(400, str(error)) from error
        return store.save_draft(exam_id, draft)

    @api.post("/exams/{exam_id}/publish")
    def publish_exam(exam_id: str, body: PublishBody) -> Exam:
        if not body.approved:
            raise HTTPException(400, "Explicit approval is required to publish.")
        return store.publish(exam_id)

    @api.post("/exams/{exam_id}/sessions", status_code=201)
    def start_session(exam_id: str, _body: StartBody) -> Session:
        return store.start_session(exam_id)

    @api.get("/sessions/{session_id}")
    def get_session(session_id: str) -> Session:
        return store.get_session(session_id)

    @api.put("/sessions/{session_id}/answers/{question_id:path}")
    def save_answer(session_id: str, question_id: str, body: AnswerBody) -> Session:
        return store.save_answer(session_id, question_id, body.text, body.math.model_dump() if body.math else None)

    @api.post("/sessions/{session_id}/math-transcription")
    def math_transcription(session_id: str, body: MathTranscriptionBody) -> dict[str, str | None]:
        if store.get_session(session_id)["status"] != "active":
            raise HTTPException(409, "This session has already been submitted.")
        try:
            return transcribe_math(body.transcript)
        except TranscriptionError as error:
            raise HTTPException(error.status_code, str(error)) from error

    @api.post("/sessions/{session_id}/submit")
    def submit_session(session_id: str, body: SubmitBody) -> Session:
        if not body.confirmed:
            raise HTTPException(400, "Explicit confirmation is required to submit.")
        return store.submit(session_id)

    @api.get("/exams/{exam_id}/submissions")
    def get_submissions(exam_id: str) -> dict[str, list[Session]]:
        return {"submissions": store.get_submissions(exam_id)}

    app.include_router(api)
    return app


app = create_app()
