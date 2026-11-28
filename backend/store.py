"""Single-process storage for the prototype assessment flow."""

from copy import deepcopy
import secrets
from threading import Lock
from typing import Literal
from uuid import uuid4

from fastapi import HTTPException
from typing_extensions import TypedDict

from .exams import Exam, InvalidDraft, validate_for_publication

# Exam codes are read aloud and typed by students, so they are short and
# avoid look-alike characters (0/O, 1/I/L). Session IDs stay as UUIDs.
EXAM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
EXAM_CODE_LENGTH = 6


def normalize_exam_id(exam_id: str) -> str:
    return exam_id.strip().upper()


class Session(TypedDict):
    id: str
    exam: Exam
    answers: dict[str, str]
    status: Literal["active", "submitted"]


class ExamStore:
    def __init__(self) -> None:
        self._exams: dict[str, Exam] = {}
        self._sessions: dict[str, Session] = {}
        self._lock = Lock()

    def create_draft(self, extracted: Exam) -> Exam:
        exam = deepcopy(extracted)
        with self._lock:
            exam["id"] = self._new_exam_code()
            self._exams[exam["id"]] = exam
            return deepcopy(exam)

    def get_exam(self, exam_id: str) -> Exam:
        with self._lock:
            return deepcopy(self._exam(exam_id))

    def save_draft(self, exam_id: str, replacement: Exam) -> Exam:
        with self._lock:
            self._draft(exam_id)
            self._exams[normalize_exam_id(exam_id)] = deepcopy(replacement)
            return deepcopy(replacement)

    def publish(self, exam_id: str) -> Exam:
        with self._lock:
            exam = self._draft(exam_id)
            if exam["needs_review"]:
                raise HTTPException(409, "Resolve all review items before publishing.")
            try:
                validate_for_publication(exam)
            except InvalidDraft as error:
                raise HTTPException(409, str(error)) from error
            exam["status"] = "published"
            return deepcopy(exam)

    def start_session(self, exam_id: str) -> Session:
        with self._lock:
            exam = self._exam(exam_id)
            if exam["status"] != "published":
                raise HTTPException(409, "This exam is awaiting publication.")
            student_exam = deepcopy(exam)
            student_exam["warnings"] = []
            session: Session = {
                "id": uuid4().hex,
                "exam": student_exam,
                "answers": {},
                "status": "active",
            }
            self._sessions[session["id"]] = session
            return deepcopy(session)

    def get_session(self, session_id: str) -> Session:
        with self._lock:
            return deepcopy(self._session(session_id))

    def save_answer(self, session_id: str, question_id: str, text: str) -> Session:
        with self._lock:
            session = self._active_session(session_id)
            if not any(question["id"] == question_id for question in session["exam"]["questions"]):
                raise HTTPException(404, "Question ID was not found.")
            session["answers"][question_id] = text
            return deepcopy(session)

    def submit(self, session_id: str) -> Session:
        with self._lock:
            session = self._active_session(session_id)
            session["status"] = "submitted"
            return deepcopy(session)

    def get_submissions(self, exam_id: str) -> list[Session]:
        with self._lock:
            exam_id = self._exam(exam_id)["id"]
            return [
                deepcopy(session)
                for session in self._sessions.values()
                if session["exam"]["id"] == exam_id and session["status"] == "submitted"
            ]

    def _new_exam_code(self) -> str:
        while True:
            code = "".join(secrets.choice(EXAM_CODE_ALPHABET) for _ in range(EXAM_CODE_LENGTH))
            if code not in self._exams:
                return code

    def _exam(self, exam_id: str) -> Exam:
        exam = self._exams.get(normalize_exam_id(exam_id))
        if exam is None:
            raise HTTPException(404, "Exam ID was not found.")
        return exam

    def _draft(self, exam_id: str) -> Exam:
        exam = self._exam(exam_id)
        if exam["status"] != "draft":
            raise HTTPException(409, "Only drafts can be edited or published.")
        return exam

    def _session(self, session_id: str) -> Session:
        session = self._sessions.get(session_id)
        if session is None:
            raise HTTPException(404, "Session ID was not found.")
        return session

    def _active_session(self, session_id: str) -> Session:
        session = self._session(session_id)
        if session["status"] != "active":
            raise HTTPException(409, "This session has already been submitted.")
        return session
