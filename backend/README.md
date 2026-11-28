# Tamkeen backend

Run from the repository root with Python 3.11 or newer.

```sh
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Vite forwards the existing frontend’s `/api` requests to this port. Choose **Real API** in the frontend. The health endpoint is `GET /api/health`.

The default extractor loads `document_engine.extract_exam(pdf_bytes)` when a professor uploads a file. The document team supplies the implementation and any provider configuration. A missing or unavailable engine returns HTTP 503. Uploads use multipart field `file` and accept PDFs up to 10 MiB, matching the frontend scanner’s generated PDF limit. PDF content extraction belongs to the document engine.

For a development demo, set `TAMKEEN_EXTRACTOR=fixture` before starting Uvicorn. In PowerShell use `$env:TAMKEEN_EXTRACTOR = 'fixture'`. Upload a synthetic PDF. The resulting draft uses `fixtures/demo_exam.json` and includes a fixture-mode warning in professor review. Set the mode back to `document` for extraction testing.

Each upload gets a six-character exam code, such as `K7M4QX`, for the professor to share with students. Codes avoid look-alike characters (0, O, 1, I and L), and lookups ignore letter case and surrounding spaces. Session IDs remain long random identifiers.

Professors can save schema-valid drafts while resolving circuit issues. Publication requires a cleared review flag and explicit approval. The server checks the circuit nodes and terminals before publishing. Student sessions receive the published questions and an empty warnings array. Extraction warnings remain available on the professor’s exam. Answers keep their exact text and become read-only on confirmed submission.

The prototype uses process-local memory. Run a single worker. Restarting the server clears all exams and sessions. Use synthetic content.

## Tests

```sh
python -m pip install -r backend/requirements-test.txt
python -m unittest discover -s backend -p 'test_*.py'
```

For a browser check, run the existing Vite frontend and FastAPI together. In **Real API**, upload a synthetic PDF, review and publish the draft, start a session with its ID, confirm an answer, submit, and load the results in Professor. Repeat in document mode once the extraction implementation is available.

## Math dictation

Set `GROQ_API_KEY` in the backend process environment before starting Uvicorn. `GROQ_MODEL` is optional and defaults to `openai/gpt-oss-20b`. Use a Groq Free Plan key for the demo. The application sends one expression per request and shares only the transcript, with no question, stored answer, or tool access.

For a synthetic demo, start FastAPI in fixture mode and choose **Real API** in the frontend. Upload a synthetic PDF, approve and publish the fixture, then start its student session. On the math or circuit question, choose **Dictate math** or say “dictate math” in a voice-command turn. Review the original transcript, LaTeX, and spoken notation before confirming. Try “X plus Y over Z” to exercise clarification and then dictate the full expression again with explicit grouping. The original transcript remains available for confirmation when the provider fails.

The backend test suite uses mocked responses. To also run the live examples against a configured Groq account, set `TAMKEEN_TEST_LIVE_GROQ=1` before running `python -m unittest backend.test_math_transcription`. Use synthetic expressions. The service validates structure and rejects common direct assistance requests. The student still needs to verify that the interpretation faithfully represents their speech.
