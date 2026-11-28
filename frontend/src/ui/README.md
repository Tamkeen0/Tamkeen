# Tamkeen frontend

The frontend starts at `App.tsx`. It has a Professor workspace for upload, review, publication, and submissions, and a Student workspace for taking a published exam. Use synthetic material for the demo.

## Run locally

From `frontend/`, use Node 20 or later and the project's lead-provisioned dependencies. The lead handles dependency installation and lockfiles.

```sh
npm run dev
npm run build
```

Open the URL printed by Vite. The app starts in **Demo fixture** mode. Upload a nonempty `.pdf` to open a draft based on `fixtures/demo_exam.json`. The mock treats the file as a placeholder and stores exams and sessions in memory. The Student workspace can also start the prepublished fixture using its prefilled exam ID.

## Trying voice in Chrome

In an integrated checkout that includes `frontend/src/voice/index.ts`, open **Student**, keep exam ID `demo`, and choose **Start exam**. Test the microphone or continue without it. On a question or review, expand **Voice commands and settings** to find **Voice feedback**. **Screen reader** is the default. Question changes move focus to the question heading for normal screen-reader reading. Use **App voice** for synthesized speech or **App voice, then screen reader** to receive the same voice response in sequence.

Use **Listen for command** and say “go to question three”, then “walk me through this diagram”. Say “next part” to advance the circuit tour. Use **Dictate answer** to enter literal text. In a separate command turn, say “add”, “replace”, or “undo” to edit the draft. Review it before saving. Saying “submit” opens a review. Say “confirm” there or use the **Submit exam** button.

Use **Stop voice** or Escape to stop speech. Words already heard during dictation stay in the current question’s draft. The keyboard controls remain available if microphone or app speech fails.

## Welcome and workspaces

Choose **Professor** or **Student** from Welcome or the main navigation. The first Tab from page load reaches **Skip to main content**. Returning to Welcome preserves the open workspace state. Changing the data source starts a fresh workspace.

Student questions appear one at a time in reading order. Open **Explore circuit facts** on a circuit question to read the approved description, nodes, component values and terminal connections. **Previous question** and **Next question** move between questions. Expand **Exam progress** to jump to a question and check for confirmed answers, unconfirmed edits, and unanswered questions. **Review answer** shows the literal draft for editing or explicit confirmation. **Review submission** lists confirmed answers and warns about unanswered questions and edits before the final submission.

Professor review shows one question at a time. The question navigation preserves edits, and a question-specific validation error opens the affected question. A fresh upload or scan has a local source-PDF preview while reviewing the draft.

## English interface

The application uses English labels, validation, status messages, and voice prompts. Exam content, circuit facts, student answers, extraction warnings, and server-supplied error details are displayed as supplied. Authored content can retain its natural text direction inside the left-to-right interface. The operating system controls the file picker dialog.

## Pre-exam microphone check

In the Student workspace, **Start exam** opens **Microphone Check** for the entered exam ID. **Test microphone** requests permission and checks for audio input for up to eight seconds after the stream opens. Speak briefly in your usual voice. **Continue without microphone** is available at any point, and **Cancel** or Escape returns to the entry form. Only continuing starts the exam session.

The check requires a secure page and browser microphone and Web Audio support. It samples levels locally and releases the microphone when the check ends or the page is hidden. No audio is recorded or stored. Detecting audio verifies browser input. Speech recognition is handled separately by the Voice module.

## Accessibility Studio

Open **Accessibility** from the header on any screen, or **Exam accessibility** during an active exam. Text size (100–200%) and the six contrast presets are available immediately. Expand **Custom colors and spacing** for line, letter, and word spacing and custom reading colors. Custom pairs require at least 4.5:1 contrast. An invalid pair leaves the last accessible colors in place. Expand **Focus and visibility** for focus outlines, motion, link underlines, control boundaries, and question separation.

Expand **Live preview** to try the settings on sample content. Settings apply immediately and only affect presentation. Browser storage under `tamkeen.accessibility.v1` contains visual preferences. If storage is unavailable, settings remain active until reload. Use **Reset to defaults** to restore the original theme and settings. Close with Escape or **Close** to return focus to the button that opened the Studio. System reduced-motion and forced-colors settings remain supported.

For acceptance, open the Studio during an exam with an answer edit, an open circuit, or active mocked voice. Change preferences, close the dialog, then verify the same exam state and continue. Repeat during a draft with approval checked and while a camera capture or upload is in progress. At 320 px, verify the layout at 200% text size with all three spacing settings at maximum.

## Scan paper exams with a camera

1. In **Professor**, choose **Scan with Camera**. Allow camera access in your browser. Camera capture requires a supported browser on HTTPS or localhost. On a phone accessing a development server over the network, use HTTPS.
2. Center the whole page in good light and choose **Capture**. Inspect the preview, or open it full size to check small text and diagram labels. Use **Retake** to replace the selected photo or **Add Page** to capture another one.
3. Select a page thumbnail to preview it. Use **Move earlier**, **Move later**, or **Remove** to set the final order. The scan supports up to 20 pages and a 10 MiB PDF. **Cancel** asks for confirmation if there are captures to discard. The existing **Upload PDF** option is available throughout.
4. Choose **Continue** to create an image-only PDF and upload it through the usual exam endpoint. Captures remain available if PDF creation or upload fails. The camera shuts off after capture, on close, when leaving the workspace or hiding the tab, and before upload. Captured pages are held for the current scan in the browser.

The browser scales photos down to at most 2,200 pixels on the longest edge and encodes them as JPEG. The PDF fits each complete photo on a portrait or landscape US Letter page in the chosen order. Clear framing and visual review still matter. The app only sends the final PDF to the configured same-origin exam endpoint. In Demo fixture mode, the upload opens the sample draft for review.

## Acceptance checks

1. In **Professor**, upload a synthetic PDF. Check that the draft shows original wording, accessible wording, warnings, and circuit fields. Edit and save, then approve and publish. Open the published exam by ID and check the empty submissions state.
2. In **Student**, use Tab, Enter or Space, and standard keyboard text editing. Verify focus moves to the current question or review heading. Review an answer, choose **Edit answer**, then verify focus returns to the answer field. Confirm an edit, navigate away and back, and verify the saved text is literal.
3. Open **Explore circuit facts** using the keyboard. Verify the component values and terminal nodes match the approved draft. With voice available, verify it gives approved facts and refuses a request to solve the item.
4. Review submission with an unanswered question or unconfirmed edit. Return to the exam, then review and submit. Verify the submitted screen is read-only and Professor can reload its confirmed answers in submissions.
5. Repeat with a screen reader and at a narrow viewport. Check landmarks, heading order, input names, focus moves, announced progress and errors, and reflow. With the voice module present, test microphone denial, literal dictation of a command-like phrase, speech readback, and explicit voice confirmation. Every step can be completed with keyboard controls.
6. Repeat the full flow at desktop, tablet, and 320px widths. Check that mathematical notation and mixed-script answers remain unchanged through review, confirmation, and professor results.
7. Test camera permission, capture, retake, selection, reordering, removal, and cancel with keyboard controls. Verify tracks stop after capture and on navigation. Retry a rejected scan upload and check that the page previews stay available. Open the uploaded PDF in a viewer and compare its pages to the selected order. Repeat on a physical desktop and mobile camera to check framing and readability.
8. Verify the welcome role controls, draft question navigation, and student progress map with the keyboard. Open the scan discard dialog, confirm that **Keep pages** receives focus, press Escape, and check focus returns to **Cancel**. Use forced colors and reduced motion to verify that focus and status remain understandable.

## Backend and voice integration

- Run the lead's FastAPI service at `127.0.0.1:8000` and start Vite. The existing dev proxy forwards same-origin `/api` calls. Select **Real API** to exercise the service. A separately hosted production build needs the same `/api` routing from its host.
- The UI follows `contracts/API.md`. Upload uses multipart `file`. Review saves the full draft with `PUT /api/exams/{id}`. After explicit approval, the UI saves `needs_review: false` and requests publication with `{ "approved": true }`. The server must reject publication if review remains unresolved.
- Camera scans use the same multipart upload as selected PDFs. Scanned PDF support and the server's upload limit are unconfirmed on this checkout. The backend and document teams need to test whether image-only PDFs can produce faithful drafts, confirm their actual upload limit, and return a clear error for unsupported scans. Demo mode uses the fixture without extracting the scan.
- Student start uses `POST /api/exams/{id}/sessions` and accepts a published exam in an active session. Confirmed answers use `{ "text": "…" }` verbatim. Final submission uses `{ "confirmed": true }`. Professor results expect `{ "submissions": [...] }` from the submissions endpoint. When a publish or submit response fails, the UI checks the exam or session with `GET` to recover an already-completed transition.
- Include the voice team's `frontend/src/voice/index.ts` when building. The UI imports only the public voice API and pauses recognition before requesting speech. The keyboard path is available in the build without the voice module. The Voice module must configure recognition and speech playback for an English locale when the browser supports it. The public API carries no locale argument, so the UI supplies English commands and prompts through the existing functions.
