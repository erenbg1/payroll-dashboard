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
import time
import hmac
import hashlib
import base64
from pydantic import BaseModel

class SaveRequest(BaseModel):
    month: str
    data: List[dict]


class LoginRequest(BaseModel):
    password: str

DATA_STORE_DIR = os.path.join(os.path.dirname(__file__), "data_store")
AUDIT_LOG_PATH = os.path.join(DATA_STORE_DIR, "audit_log.jsonl")
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD")
AUTH_TOKEN_SECRET = os.getenv("AUTH_TOKEN_SECRET", "trel-payroll-dashboard-secret")
AUTH_TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", "43200"))
LOGIN_WINDOW_SECONDS = int(os.getenv("LOGIN_WINDOW_SECONDS", "3600"))
MAX_LOGIN_ATTEMPTS = int(os.getenv("MAX_LOGIN_ATTEMPTS", "3"))
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
LOGIN_ATTEMPTS = {}
if not os.path.exists(DATA_STORE_DIR):
    os.makedirs(DATA_STORE_DIR)

if not DASHBOARD_PASSWORD:
    raise RuntimeError("DASHBOARD_PASSWORD environment variable is required")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS else ["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.get("/")
def read_root():
    return {"message": "Payroll API is running. Please use the frontend to interact."}


def _get_client_ip(request: Request):
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    remote_addr = getattr(request, "remote_addr", None)
    if remote_addr:
        return remote_addr
    return request.client.host if request.client else "-"


def _get_user_agent(request: Request):
    return request.headers.get("user-agent", "-").strip() or "-"


def _build_audit_log_entry(action: str, request: Request, previous_hash: str):
    timestamp = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    ip_address = _get_client_ip(request) or "-"
    user_agent = _get_user_agent(request)
    hash_input = f"{previous_hash}|{timestamp}|{action}|{ip_address}|{user_agent}"
    entry_hash = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()

    return {
        "timestamp": timestamp,
        "action": action,
        "ip_address": ip_address,
        "user_agent": user_agent,
        "previous_hash": previous_hash,
        "entry_hash": entry_hash,
    }


def _read_audit_logs():
    if not os.path.exists(AUDIT_LOG_PATH):
        return []

    entries = []
    try:
        with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as file_handle:
            for line in file_handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except Exception:
        return []

    return entries


def _append_audit_log(action: str, request: Request):
    existing_logs = _read_audit_logs()
    previous_hash = existing_logs[-1].get("entry_hash", "") if existing_logs else ""
    entry = _build_audit_log_entry(action, request, previous_hash)

    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as file_handle:
        file_handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        file_handle.flush()
        os.fsync(file_handle.fileno())

    return entry


def _prune_login_attempts(now_timestamp: int):
    stale_ips = [
        ip_address
        for ip_address, state in LOGIN_ATTEMPTS.items()
        if now_timestamp - state.get("last_attempt", 0) > LOGIN_WINDOW_SECONDS
        and state.get("blocked_until", 0) <= now_timestamp
    ]

    for ip_address in stale_ips:
        LOGIN_ATTEMPTS.pop(ip_address, None)


def _check_login_limit(request: Request):
    now_timestamp = int(time.time())
    _prune_login_attempts(now_timestamp)
    ip_address = _get_client_ip(request)
    attempt_state = LOGIN_ATTEMPTS.get(ip_address, {"count": 0, "last_attempt": 0, "blocked_until": 0})

    if attempt_state.get("blocked_until", 0) > now_timestamp:
        raise HTTPException(
            status_code=429,
            detail={
                "message": "Too many login attempts. Please try again later.",
                "attemptsUsed": MAX_LOGIN_ATTEMPTS,
                "maxAttempts": MAX_LOGIN_ATTEMPTS,
                "blockedUntil": attempt_state.get("blocked_until", 0),
            },
        )

    return attempt_state


def _record_failed_login(request: Request):
    now_timestamp = int(time.time())
    ip_address = _get_client_ip(request)
    attempt_state = LOGIN_ATTEMPTS.get(ip_address, {"count": 0, "last_attempt": 0, "blocked_until": 0})

    if now_timestamp - attempt_state.get("last_attempt", 0) > LOGIN_WINDOW_SECONDS:
        attempt_state = {"count": 0, "last_attempt": 0, "blocked_until": 0}

    attempt_state["count"] += 1
    attempt_state["last_attempt"] = now_timestamp

    if attempt_state["count"] >= MAX_LOGIN_ATTEMPTS:
        attempt_state["blocked_until"] = now_timestamp + LOGIN_WINDOW_SECONDS

    LOGIN_ATTEMPTS[ip_address] = attempt_state
    return attempt_state


def _clear_login_attempts(request: Request):
    LOGIN_ATTEMPTS.pop(_get_client_ip(request), None)


def _build_auth_token():
    expires_at = int(time.time()) + AUTH_TOKEN_TTL_SECONDS
    nonce = os.urandom(16).hex()
    payload = f"{expires_at}:{nonce}"
    signature = hmac.new(
        AUTH_TOKEN_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    token_value = f"{payload}:{signature}"
    token_bytes = token_value.encode("utf-8")
    return base64.urlsafe_b64encode(token_bytes).decode("utf-8"), expires_at


def _decode_auth_token(token: str):
    try:
        decoded = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
        expires_at, nonce, provided_signature = decoded.split(":", 2)
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

    payload = f"{expires_at}:{nonce}"
    expected_signature = hmac.new(
        AUTH_TOKEN_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, provided_signature):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if int(expires_at) < int(time.time()):
        raise HTTPException(status_code=401, detail="Session expired")

    return {"expiresAt": int(expires_at)}


def _require_auth(request: Request):
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")

    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    return _decode_auth_token(token)


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


@app.post("/auth/login")
async def login(payload: LoginRequest, request: Request):
    try:
        _check_login_limit(request)
    except HTTPException:
        _append_audit_log("LOGIN_FAILED", request)
        raise

    if not hmac.compare_digest(payload.password, DASHBOARD_PASSWORD):
        failed_state = _record_failed_login(request)
        _append_audit_log("LOGIN_FAILED", request)
        blocked_until = failed_state.get("blocked_until", 0)
        message = "Invalid password"
        if blocked_until and blocked_until > int(time.time()):
            message = "Too many login attempts. Please try again later."

        status_code = 429 if blocked_until and blocked_until > int(time.time()) else 401
        raise HTTPException(
            status_code=status_code,
            detail={
                "message": message,
                "attemptsUsed": min(failed_state.get("count", 0), MAX_LOGIN_ATTEMPTS),
                "maxAttempts": MAX_LOGIN_ATTEMPTS,
                "blockedUntil": blocked_until,
            },
        )

    _clear_login_attempts(request)
    token, expires_at = _build_auth_token()
    _append_audit_log("LOGIN_SUCCESS", request)
    return {
        "token": token,
        "expiresAt": expires_at,
        "attemptsUsed": 0,
        "maxAttempts": MAX_LOGIN_ATTEMPTS,
        "blockedUntil": 0,
    }


@app.get("/auth/status")
async def auth_status(request: Request):
    auth_data = _require_auth(request)
    return {"authenticated": True, "expiresAt": auth_data["expiresAt"]}

@app.post("/upload")
async def upload_files(request: Request, files: List[UploadFile] = File(...)):
    _require_auth(request)
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
    _require_auth(request)
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
async def list_datasets(request: Request):
    _require_auth(request)
    return {"datasets": _list_active_datasets()}

@app.get("/list-months")
async def list_months(request: Request):
    _require_auth(request)
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
async def list_history(request: Request):
    _require_auth(request)
    return {"history": list(reversed(_read_audit_logs()))}

@app.get("/load-month/{month}")
async def load_month(month: str, request: Request):
    _require_auth(request)
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
    _require_auth(request)
    filepath = _find_dataset_path(dataset_id)

    if not filepath or not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        dataset = _load_dataset_from_path(filepath)
        os.remove(filepath)
        return {"message": f"Deleted dataset {dataset['version']}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
