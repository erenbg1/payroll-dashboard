import pdfplumber
import re
import pandas as pd

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


def extract_data_from_pdf(pdf_file, filename):
    extracted_data = []
    seen_personnel_numbers = set()

    # --- Pass 1: Collect names of employees that appear on correction pages ---
    korrektur_names = set()
    with pdfplumber.open(pdf_file) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue
            if KORREKTUR_REGEX.search(text):
                name = _extract_name_from_lines(text.split('\n'))
                if name != "Unknown":
                    korrektur_names.add(name)

    # --- Pass 2: Normal extraction, applying Korrektur keyword where detected ---
    with pdfplumber.open(pdf_file) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text()
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
