import io
import re

import pdfplumber
from pypdf import PdfReader

KORREKTUR_REGEX = re.compile(r"Korrektur\s+in")

SKIP_KEYWORDS = ["Mehrfachbeschäftigung", "Midijob", "Elterneigenschaft", "Krankenkasse", "Personalgruppe", "Geringfügig"]

def _extract_name_from_lines(lines):
    """Extract employee name by scanning for salutation then looking ahead."""
    for j, line in enumerate(lines):
        if line.strip() in ["Herr", "Frau", "Herrn"]:
            for k in range(1, 5):
                if j + k < len(lines):
                    candidate = lines[j + k].strip()
                    if not candidate:
                        continue
                    if any(kw in candidate for kw in SKIP_KEYWORDS):
                        continue
                    return candidate
    return "Unknown"


def _read_pdf_bytes(pdf_file):
    if hasattr(pdf_file, "getvalue"):
        return pdf_file.getvalue()

    if hasattr(pdf_file, "seek"):
        pdf_file.seek(0)

    return pdf_file.read()


def _extract_texts_with_pdfplumber(pdf_bytes):
    page_texts = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            try:
                page_texts.append(page.extract_text() or "")
            except Exception:
                page_texts.append("")

    return page_texts


def _extract_texts_with_pypdf(pdf_bytes):
    page_texts = []
    reader = PdfReader(io.BytesIO(pdf_bytes))

    for page in reader.pages:
        try:
            page_texts.append(page.extract_text() or "")
        except Exception:
            page_texts.append("")

    return page_texts


def _extract_page_texts(pdf_file):
    pdf_bytes = _read_pdf_bytes(pdf_file)
    last_error = None

    for extractor in (_extract_texts_with_pypdf, _extract_texts_with_pdfplumber):
        try:
            page_texts = extractor(pdf_bytes)
            if page_texts:
                return page_texts
        except Exception as exc:
            last_error = exc

    if last_error is not None:
        raise last_error

    return []


def extract_data_from_pdf(pdf_file, filename):
    extracted_data = []
    seen_personnel_numbers = set()
    page_texts = _extract_page_texts(pdf_file)

    # --- Pass 1: Collect names of employees that appear on correction pages ---
    korrektur_names = set()
    for text in page_texts:
        if not text:
            continue
        if KORREKTUR_REGEX.search(text):
            name = _extract_name_from_lines(text.split('\n'))
            if name != "Unknown":
                korrektur_names.add(name)

    # --- Pass 2: Normal extraction, applying Korrektur keyword where detected ---
    for i, text in enumerate(page_texts):
        if not text:
            continue

        lines = text.split('\n')
        personal_nr = None
        name = "Unknown"

        # 1. Personal-Nr (User's Verified Regex)
        # Matches header "Personal-Nr." followed by whatever on line, then newline, then number
        # This handles the two-line split
        pnr_match = re.search(r"Personal-Nr\.[^\n]*\n\s*(\d+)", text)
        if pnr_match:
            personal_nr = pnr_match.group(1)
        else:
             # Fallback: sometimes text extraction might join lines differently or simple format
             pnr_match_simple = re.search(r"Personal-Nr\.?\s*(\d{4,})", text)
             if pnr_match_simple:
                 personal_nr = pnr_match_simple.group(1)

        # 2. Name Extraction
        name = _extract_name_from_lines(lines)

        # 3. Auszahlung (User's Verified Regex)
        auszahlung_raw = 0.0
        auszahlung_str = "0,00"

        # User Regex: r"Auszahlung\s+([0-9\.\,]+)"
        auszahlung_match = re.search(r"Auszahlung\s+([0-9\.\,]+)", text)
        if auszahlung_match:
            auszahlung_str = auszahlung_match.group(1)
            clean_auszahlung = auszahlung_str.replace('.', '').replace(',', '.')
            try:
                auszahlung_raw = float(clean_auszahlung)
            except ValueError:
                auszahlung_raw = 0.0

        # 4. Handle Business Rule (Duplicates)
        # User request: "I dont want any duplicates."
        # We only keep the FIRST occurrence of a Personal-Nr.
        if personal_nr and personal_nr in seen_personnel_numbers:
            continue # Skip duplicate

        if personal_nr:
            seen_personnel_numbers.add(personal_nr)

        final_auszahlung = auszahlung_raw

        # 5. Keywords
        keywords_found = []
        user_keywords = ["Sachbezug", "Pfändung", "Lohnschuld"]

        text_lower = text.lower()
        for kw in user_keywords:
            if kw.lower() in text_lower:
                keywords_found.append(kw)

        # Korrektur: added once per employee if their name appeared on a correction page
        if name in korrektur_names:
            keywords_found.append("Korrektur")

        keywords_str = ", ".join(keywords_found) if keywords_found else ""

        extracted_data.append({
            "Filename": filename,
            "Page": i + 1,
            "Personal-Nr": personal_nr if personal_nr else "Unknown",
            "Name": name,
            "Auszahlung": final_auszahlung,
            "Keywords": keywords_str,
            "Raw_Auszahlung_Str": auszahlung_str
        })

    return extracted_data
