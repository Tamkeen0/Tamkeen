# Tamkeen backend

Run from the repository root with Python 3.11 or newer.

```sh
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Vite forwards the existing frontend’s `/api` requests to this port. Choose **Real API** in the frontend. The health endpoint is `GET /api/health`.

The default extractor loads `document_engine.extract_exam(pdf_bytes)` when a professor uploads a file. The document team supplies the implementation and any provider configuration. A missing or unavailable engine returns HTTP 503. Uploads use multipart field `file` and accept PDFs up to 10 MiB, matching the frontend scanner’s generated PDF limit. PDF content extraction belongs to the document engine.

For a development demo, set `TAMKEEN_EXTRACTOR=fixture` before starting Uvicorn. In PowerShell use `$env:TAMKEEN_EXTRACTOR = 'fixture'`. Upload a synthetic PDF. The resulting draft uses `fixtures/demo_exam.json` and includes a fixture-mode warning in professor review. Set the mode back to `document` for extraction testing.

Professors can save schema-valid drafts while resolving circuit issues. Publication requires a cleared review flag and explicit approval. The server checks the circuit nodes and terminals before publishing. Student sessions receive the published questions and an empty warnings array. Extraction warnings remain available on the professor’s exam. Answers keep their exact text and become read-only on confirmed submission.

The prototype uses process-local memory. Run a single worker. Restarting the server clears all exams and sessions. Use synthetic content.

## Tests

```sh
python -m pip install -r backend/requirements-test.txt
python -m unittest discover -s backend -p 'test_*.py'
```

For a browser check, run the existing Vite frontend and FastAPI together. In **Real API**, upload a synthetic PDF, review and publish the draft, start a session with its ID, confirm an answer, submit, and load the results in Professor. Repeat in document mode once the extraction implementation is available.
