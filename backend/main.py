from datetime import datetime
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict
import pandas as pd
import io
import extraction
import os
import json
import re
from pydantic import BaseModel

class SaveRequest(BaseModel):
    month: str
    data: List[dict]

DATA_STORE_DIR = os.path.join(os.path.dirname(__file__), "data_store")
HISTORY_LOG_PATH = os.path.join(DATA_STORE_DIR, "_history_log.json")
if not os.path.exists(DATA_STORE_DIR):
    os.makedirs(DATA_STORE_DIR)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.get("/")
def read_root():
    return {"message": "Payroll API is running. Please use the frontend to interact."}


def _get_now():
    return datetime.now()


def _format_timestamp(value: datetime):
    return value.strftime("%Y-%m-%d %H:%M")


def _format_file_timestamp(value: datetime):
    return value.strftime("%Y%m%d%H%M%S")


def _slugify(value: str):
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip()).strip("-").lower()
    return slug or "month"


def _normalize_month_label(value: str):
    if not value:
        return value

    normalized = value.strip()
    direct_match = re.match(
        r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$",
        normalized,
    )
    if direct_match:
        return normalized

    version_match = re.match(
        r"^(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+v\d+)?\s+(\d{4})$",
        normalized,
        re.IGNORECASE,
    )
    if version_match:
        month_name = version_match.group(1).capitalize()
        year = version_match.group(2)
        return f"{month_name} {year}"

    return normalized


def _build_version_label(month: str, version_number: int):
    normalized_month = _normalize_month_label(month)

    if version_number <= 1:
        return normalized_month

    match = re.match(r"^([A-Za-z]+)\s+(\d{4})$", normalized_month)
    if not match:
        return f"{normalized_month} v{version_number}"

    month_name = match.group(1)
    year = match.group(2)
    return f"{month_name} v{version_number} {year}"


def _dataset_filenames():
    return sorted(
        [
            filename
            for filename in os.listdir(DATA_STORE_DIR)
            if filename.endswith(".json") and filename != os.path.basename(HISTORY_LOG_PATH)
        ]
    )


def _read_json(path):
    with open(path, "r", encoding="utf-8") as file_handle:
        return json.load(file_handle)


def _write_json(path, payload):
    with open(path, "w", encoding="utf-8") as file_handle:
        json.dump(payload, file_handle, ensure_ascii=False, indent=2)


def _load_dataset_from_path(path):
    payload = _read_json(path)
    basename = os.path.splitext(os.path.basename(path))[0]
    fallback_saved_at = _format_timestamp(datetime.fromtimestamp(os.path.getmtime(path)))

    if isinstance(payload, list):
        return {
            "id": basename,
            "month": _normalize_month_label(basename),
            "version": basename,
            "savedAt": fallback_saved_at,
            "data": payload,
        }

    if isinstance(payload, dict):
        data = payload.get("data")
        return {
            "id": payload.get("id") or basename,
            "month": _normalize_month_label(payload.get("month") or basename),
            "version": payload.get("version") or payload.get("month") or basename,
            "savedAt": payload.get("savedAt") or fallback_saved_at,
            "data": data if isinstance(data, list) else [],
        }

    raise HTTPException(status_code=500, detail=f"Invalid dataset format for {basename}")


def _dataset_summary(dataset):
    return {
        "id": dataset["id"],
        "month": dataset["month"],
        "version": dataset["version"],
        "savedAt": dataset["savedAt"],
    }


def _list_active_datasets():
    datasets = []

    for filename in _dataset_filenames():
        filepath = os.path.join(DATA_STORE_DIR, filename)
        try:
            datasets.append(_dataset_summary(_load_dataset_from_path(filepath)))
        except Exception:
            continue

    datasets.sort(key=lambda dataset: dataset.get("savedAt", ""), reverse=True)
    return datasets


def _find_dataset_path(dataset_id: str):
    for filename in _dataset_filenames():
        filepath = os.path.join(DATA_STORE_DIR, filename)
        basename = os.path.splitext(filename)[0]
        if basename == dataset_id:
            return filepath

        try:
            dataset = _load_dataset_from_path(filepath)
            if dataset["id"] == dataset_id:
                return filepath
        except Exception:
            continue

    return None


def _read_history_log():
    if not os.path.exists(HISTORY_LOG_PATH):
        return []

    try:
        payload = _read_json(HISTORY_LOG_PATH)
        return payload if isinstance(payload, list) else []
    except Exception:
        return []


def _append_history_entry(dataset_id: str, month: str, version: str, ip_address: str, action: str):
    history_entries = _read_history_log()
    now = _get_now()
    history_entries.append(
        {
            "id": f"{dataset_id}-{action.lower()}-{_format_file_timestamp(now)}",
            "datasetId": dataset_id,
            "date": _format_timestamp(now),
            "month": month,
            "version": version,
            "ipAddress": ip_address or "-",
            "action": action,
        }
    )
    _write_json(HISTORY_LOG_PATH, history_entries)


def _build_history_entries():
    datasets = _list_active_datasets()
    active_dataset_ids = {dataset["id"] for dataset in datasets}
    history_entries = []

    for entry in _read_history_log():
        dataset_id = entry.get("datasetId", "")
        history_entries.append(
            {
                "id": entry.get("id") or f"{dataset_id}-{entry.get('action', 'saved').lower()}",
                "datasetId": dataset_id,
                "date": entry.get("date") or "",
                "month": entry.get("month") or "-",
                "version": entry.get("version") or entry.get("month") or "-",
                "ipAddress": entry.get("ipAddress") or "-",
                "action": entry.get("action") or "Saved",
                "canDelete": entry.get("action") == "Saved" and dataset_id in active_dataset_ids,
            }
        )

    logged_save_ids = {
        entry["datasetId"]
        for entry in history_entries
        if entry["action"] == "Saved" and entry.get("datasetId")
    }

    for dataset in datasets:
        if dataset["id"] in logged_save_ids:
            continue
        history_entries.append(
            {
                "id": f"legacy-{dataset['id']}",
                "datasetId": dataset["id"],
                "date": dataset["savedAt"],
                "month": dataset["month"],
                "version": dataset["version"],
                "ipAddress": "-",
                "action": "Saved",
                "canDelete": True,
            }
        )

    history_entries.sort(key=lambda entry: entry.get("date", ""), reverse=True)
    return history_entries

@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    combined_results = []
    
    for file in files:
        if not file.filename.endswith('.pdf'):
            continue
            
        try:
            content = await file.read()
            pdf_file = io.BytesIO(content)
            results = extraction.extract_data_from_pdf(pdf_file, file.filename)
            combined_results.extend(results)
        except Exception as e:
            # In a real app we might want to return partial errors, 
            # for now we just log and continue or raise generic error
            print(f"Error processing {file.filename}: {e}")
            raise HTTPException(status_code=500, detail=f"Error processing {file.filename}: {str(e)}")

    return {"data": combined_results}

@app.post("/save-month")
async def save_month(req: SaveRequest, request: Request):
    if not req.month or not req.month.strip():
        raise HTTPException(status_code=400, detail="Month name is required")

    if not isinstance(req.data, list) or len(req.data) == 0:
        raise HTTPException(status_code=400, detail="No payroll data loaded")

    now = _get_now()
    month = _normalize_month_label(req.month.strip())
    saved_at = _format_timestamp(now)
    existing_versions = [dataset for dataset in _list_active_datasets() if dataset["month"] == month]
    version = _build_version_label(month, len(existing_versions) + 1)
    dataset_id = f"{_slugify(month)}-{_format_file_timestamp(now)}"
    filepath = os.path.join(DATA_STORE_DIR, f"{dataset_id}.json")
    dataset_payload = {
        "id": dataset_id,
        "month": month,
        "version": version,
        "savedAt": saved_at,
        "data": req.data,
    }

    try:
        _write_json(filepath, dataset_payload)
        client_host = request.client.host if request.client else "-"
        _append_history_entry(dataset_id, month, version, client_host, "Saved")
        return {
            "message": f"Successfully saved data for {month}",
            "id": dataset_id,
            "month": month,
            "version": version,
            "savedAt": saved_at,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/datasets")
async def list_datasets():
    return {"datasets": _list_active_datasets()}

@app.get("/list-months")
async def list_months():
    try:
        datasets = _list_active_datasets()
        months = []
        seen_months = set()

        for dataset in datasets:
            month = dataset["month"]
            if month in seen_months:
                continue
            seen_months.add(month)
            months.append(month)

        return {"months": months, "datasets": datasets}
    except Exception as e:
        return {"months": [], "datasets": []}

@app.get("/history")
async def list_history():
    return {"history": _build_history_entries()}

@app.get("/load-month/{month}")
async def load_month(month: str):
    filepath = _find_dataset_path(month)

    if not filepath or not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Month not found")

    try:
        dataset = _load_dataset_from_path(filepath)
        return {"data": dataset["data"], "metadata": _dataset_summary(dataset)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/dataset/{dataset_id}")
async def delete_dataset(dataset_id: str, request: Request):
    filepath = _find_dataset_path(dataset_id)

    if not filepath or not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        dataset = _load_dataset_from_path(filepath)
        os.remove(filepath)
        client_host = request.client.host if request.client else "-"
        _append_history_entry(
            dataset["id"],
            dataset["month"],
            dataset["version"],
            client_host,
            "Deleted",
        )
        return {"message": f"Deleted dataset {dataset['version']}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
