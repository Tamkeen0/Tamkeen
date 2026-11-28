"""Read the digital text layer and locate question figures."""

from dataclasses import dataclass, field
import re

_QUESTION = re.compile(r"^(?:Question\s+\d+\s*[.):]?|\d+[.):])\s+(?=\S)", re.IGNORECASE)
_OPTION = re.compile(r"^[A-Z][.)]\s*(?=\S)")
_CIRCUIT = re.compile(r"\b(circuit|resistors?|voltage sources?)\b|\b[RV]\d+\b", re.IGNORECASE)
_FIGURE_LABEL = re.compile(
    r"(?:[A-Za-z][A-Za-z0-9_-]{0,15}(?:\s+)?|[+−-])?"
    r"(?:[+−-]?\d+(?:\.\d+)?\s*(?:[kKmM]?(?:V|Ω|ohms?)))?"
)
_MATH = re.compile(r"[=+−×÷√∑∫∞≤≥≠±²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉^_]|\b\d+\s*[-/]\s*\d+\b")
_EXPONENT = re.compile(r"[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\^\d+(?![\d(/A-Za-z]|\.\d)")
_EXPONENT_DIGITS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
_SPEECH = str.maketrans({
    "=": " equals ", "+": " plus ", "−": " minus ", "×": " times ",
    "÷": " divided by ", "≤": " less than or equal to ",
    "≥": " greater than or equal to ", "≠": " does not equal ", "±": " plus or minus ",
})
_COMPLEX_MATH = re.compile(r"[√∑∫∞^_/*₀-₉⁺⁻]|\d\s*-\s*\d|\)[(\w]|\([^)]+\([^)]*\)")


@dataclass
class QuestionSource:
    lines: list[str]
    options: list[str] = field(default_factory=list)
    figures: list[bytes] = field(default_factory=list)
    ambiguous_figure: bool = False

    def add_line(self, line: str) -> None:
        if _OPTION.match(line):
            self.options.append(line)
        elif self.options:
            self.options[-1] += " " + line
        else:
            self.lines.append(line)


def _lines(page, fitz):
    flags = fitz.TEXTFLAGS_DICT & ~(fitz.TEXT_PRESERVE_IMAGES | fitz.TEXT_CID_FOR_UNKNOWN_UNICODE)
    layout = page.get_text("dict", flags=flags)
    lines = []
    for block in layout["blocks"]:
        for line in block["lines"]:
            value = "".join(span["text"] for span in line["spans"]).strip()
            if value:
                lines.append((fitz.Rect(line["bbox"]), value))
    return sorted(lines, key=lambda item: (item[0].y0, item[0].x0))


def _graphics(page, fitz):
    images = [fitz.Rect(info["bbox"]) for info in page.get_image_info()]
    paths = []
    for drawing in page.get_drawings():
        bounds = fitz.Rect(drawing["rect"])
        if bounds.width > 2 and bounds.height > 2 and page.rect.contains(bounds):
            paths.append(bounds)
        elif bounds.width > 6 or bounds.height > 6:
            # Include wire segments when a drawing takes up nonzero area overall.
            paths.append(fitz.Rect(bounds.x0 - 1, bounds.y0 - 1, bounds.x1 + 1, bounds.y1 + 1))
    return images, paths


def _capture_figure(page, fitz, images, paths, question, top, bottom, lines):
    included_images = [box for box in images if top <= box.y0 and box.y1 <= bottom]
    if len(included_images) > 1:
        question.ambiguous_figure = True
    included_paths = [box for box in paths if top <= box.y0 and box.y1 <= bottom]
    if any(box.y0 < top < box.y1 or box.y0 < bottom < box.y1 for box in images):
        question.ambiguous_figure = True

    vector_bounds = fitz.Rect()
    for box in included_paths:
        vector_bounds |= box
    if vector_bounds.height > 12 and vector_bounds.width > 12:
        included_images.append(vector_bounds)
    if not included_images:
        return

    region = fitz.Rect()
    for box in included_images:
        region |= box
    region = fitz.Rect(region.x0 - 16, region.y0 - 16, region.x1 + 16, region.y1 + 16)
    label_bounds = [
        bounds for bounds, line in lines
        if region.intersects(bounds) and _FIGURE_LABEL.fullmatch(line)
    ]
    for bounds in label_bounds:
        region |= fitz.Rect(bounds.x0 - 2, bounds.y0 - 2, bounds.x1 + 2, bounds.y1 + 2)
    region &= fitz.Rect(0, top, page.rect.width, bottom)
    if region.is_empty:
        question.ambiguous_figure = True
        return
    scale = min(3, 1600 / max(region.width, region.height))
    question.figures.append(page.get_pixmap(
        matrix=fitz.Matrix(scale, scale), clip=region, alpha=False
    ).tobytes("png"))
    return label_bounds


def _finish_section(page, fitz, images, paths, question, top, bottom, lines):
    labels = _capture_figure(page, fitz, images, paths, question, top, bottom, lines) or []
    for bounds, line in lines:
        if bounds not in labels:
            question.add_line(line)


def _read_sources(pdf_bytes):
    try:
        import pymupdf as fitz
    except ImportError as exc:
        raise RuntimeError("Digital PDF extraction requires PyMuPDF.") from exc

    try:
        pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    except (ValueError, RuntimeError) as exc:
        raise ValueError("Could not open the PDF.") from exc

    header = []
    questions = []
    with pdf:
        if pdf.needs_pass or pdf.is_repaired or not pdf.page_count:
            raise ValueError("The PDF is encrypted, damaged, or empty.")
        try:
            for page in pdf:
                if page.rotation:
                    # Text and drawing coordinates use the unrotated page.
                    page.set_rotation(0)
                lines = _lines(page, fitz)
                if not lines:
                    raise RuntimeError("A page has no digital text. Scanned pages require manual conversion.")

                images, paths = _graphics(page, fitz)
                current = questions[-1] if questions else None
                top = 0
                section_lines = []
                for bounds, line in lines:
                    marker = _QUESTION.match(line)
                    if marker:
                        if current:
                            _finish_section(
                                page, fitz, images, paths, current, top, bounds.y0, section_lines
                            )
                        current = QuestionSource([line[marker.end():]])
                        questions.append(current)
                        top = bounds.y0
                        section_lines = []
                    elif current:
                        section_lines.append((bounds, line))
                    else:
                        header.append(line)
                if current:
                    _finish_section(
                        page, fitz, images, paths, current, top, page.rect.height, section_lines
                    )
        except fitz.FileDataError as exc:
            raise ValueError("Could not read the PDF pages.") from exc
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError("Could not extract text and figures from the PDF pages.") from exc

    if not questions:
        raise RuntimeError("No numbered questions could be read. Use a digital PDF with numbered questions.")
    return header, questions


def _exponent_words(match):
    digits = match[0].removeprefix("^").translate(_EXPONENT_DIGITS)
    if digits == "2":
        return " squared"
    if digits == "3":
        return " cubed"
    return " to the power of " + digits


def _accessible_math(text):
    spoken = _EXPONENT.sub(_exponent_words, text).translate(_SPEECH)
    spoken = re.sub(r"(?<=\d)(?=[A-Za-z]\b)", " ", spoken)
    # Read parentheses literally so their grouping survives speech output.
    spoken = spoken.replace("(", " open parenthesis ").replace(")", " close parenthesis ")
    return " ".join(spoken.split())


def read_exam(pdf_bytes, extract_circuit):
    header, sources = _read_sources(pdf_bytes)
    warnings = []
    if len(header) > 1:
        warnings.append("Review the exam title and any instructions above the first question.")

    questions = []
    for number, source in enumerate(sources, start=1):
        question_id = f"q{number}"
        text = " ".join(source.lines)
        question_type = "mcq" if source.options else "text"
        accessible_text = text
        diagram = None
        complex_math = _COMPLEX_MATH.search(_EXPONENT.sub("", text))
        if _MATH.search(text):
            if not source.options:
                question_type = "math"
            if not complex_math:
                accessible_text = _accessible_math(text)
        if (
            complex_math
            or any(_MATH.search(option) for option in source.options)
            or "\ufffd" in " ".join([text, *source.options])
        ):
            warnings.append(f"{question_id}: Confirm the accessible reading against the PDF.")

        is_circuit = _CIRCUIT.search(text)
        if source.figures or source.ambiguous_figure or is_circuit:
            question_type = "diagram"
            if source.ambiguous_figure or len(source.figures) > 1:
                warnings.append(f"{question_id}: Figure placement is ambiguous. Enter the diagram manually.")
            elif not source.figures:
                warnings.append(f"{question_id}: No circuit image was located. Enter the diagram manually.")
            elif not is_circuit:
                warnings.append(f"{question_id}: This figure is unsupported. Enter the diagram manually.")
            else:
                try:
                    diagram = extract_circuit(source.figures[0])
                except RuntimeError as exc:
                    warnings.append(f"{question_id}: {exc}")
                else:
                    warnings.append(f"{question_id}: Verify every circuit label, value, and connection.")

        questions.append({
            "id": question_id,
            "type": question_type,
            "text": text,
            "accessible_text": accessible_text,
            "options": source.options,
            "diagram": diagram,
        })

    return {
        "id": "draft",
        "title": header[0] if header else "Untitled exam",
        "status": "draft",
        "needs_review": bool(warnings),
        "warnings": warnings,
        "questions": questions,
    }
