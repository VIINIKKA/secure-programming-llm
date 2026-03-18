import base64
import hashlib
import secrets
import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import jwt
from fastapi import HTTPException, Request
from jwt import InvalidTokenError

from app.config import Settings

USERNAME_ALLOWED = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 240_000
PASSWORD_SALT_BYTES = 16


@dataclass(frozen=True)
class AuthIdentity:
    subject: str
    role: str
    scopes: frozenset[str]
    session_id: str
    auth_type: str


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int
    refresh_expires_in: int
    role: str
    scopes: list[str]


@dataclass(frozen=True)
class SessionRecord:
    session_id: str
    subject: str
    role: str
    scopes: list[str]
    expires_at: int


@dataclass(frozen=True)
class UserRecord:
    username: str
    role: str
    scopes: list[str]


def _parse_scopes(value: str) -> list[str]:
    cleaned = value.replace(",", " ").split()
    return sorted({scope.strip() for scope in cleaned if scope.strip()})


def _serialize_scopes(scopes: list[str]) -> str:
    return " ".join(sorted({scope.strip() for scope in scopes if scope.strip()}))


def normalize_username(username: str) -> str:
    cleaned = username.strip()
    if len(cleaned) < 3 or len(cleaned) > 64:
        raise ValueError("Username must be between 3 and 64 characters.")
    if any(char not in USERNAME_ALLOWED for char in cleaned):
        raise ValueError("Username contains unsupported characters.")
    return cleaned.lower()


def _validate_password_policy(password: str, settings: Settings) -> None:
    min_len = max(8, settings.auth_min_password_length)
    if len(password) < min_len:
        raise ValueError(f"Password must be at least {min_len} characters.")
    if not any(char.isalpha() for char in password):
        raise ValueError("Password must include at least one letter.")
    if not any(char.isdigit() for char in password):
        raise ValueError("Password must include at least one number.")


def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64_decode(value: str) -> bytes:
    padding = "=" * ((4 - (len(value) % 4)) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}")


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(PASSWORD_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS)
    return f"{PASSWORD_HASH_ALGORITHM}${PASSWORD_HASH_ITERATIONS}${_b64_encode(salt)}${_b64_encode(digest)}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations_raw, salt_raw, expected_raw = stored_hash.split("$", 3)
        if algorithm != PASSWORD_HASH_ALGORITHM:
            return False
        iterations = int(iterations_raw)
        salt = _b64_decode(salt_raw)
        expected = _b64_decode(expected_raw)
    except (ValueError, TypeError):
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return secrets.compare_digest(actual, expected)


def _token_hash(token_id: str) -> str:
    return hashlib.sha256(token_id.encode("utf-8")).hexdigest()


def _now_utc() -> datetime:
    return datetime.now(UTC)


class SessionStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = Path(db_path)
        if self._db_path.parent:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._init_schema()

    def _init_schema(self) -> None:
        with self._conn:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    subject TEXT NOT NULL,
                    role TEXT NOT NULL,
                    scopes TEXT NOT NULL,
                    refresh_jti_hash TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    rotated_at INTEGER,
                    revoked_at INTEGER
                )
                """
            )
            self._conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_sessions_subject
                ON sessions(subject)
                """
            )
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    scopes TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    disabled_at INTEGER
                )
                """
            )

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    @staticmethod
    def _deserialize_session(row: sqlite3.Row) -> SessionRecord:
        scopes = [scope for scope in str(row["scopes"]).split(" ") if scope]
        return SessionRecord(
            session_id=str(row["session_id"]),
            subject=str(row["subject"]),
            role=str(row["role"]),
            scopes=scopes,
            expires_at=int(row["expires_at"]),
        )

    @staticmethod
    def _deserialize_user(row: sqlite3.Row) -> UserRecord:
        scopes = [scope for scope in str(row["scopes"]).split(" ") if scope]
        return UserRecord(
            username=str(row["username"]),
            role=str(row["role"]),
            scopes=scopes,
        )

    def upsert_user(self, username: str, password: str, role: str, scopes: list[str]) -> None:
        now_ts = int(_now_utc().timestamp())
        serialized_scopes = _serialize_scopes(scopes)
        password_hash = _hash_password(password)
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO users(username, password_hash, role, scopes, created_at, updated_at, disabled_at)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT(username) DO UPDATE SET
                    password_hash = excluded.password_hash,
                    role = excluded.role,
                    scopes = excluded.scopes,
                    updated_at = excluded.updated_at,
                    disabled_at = NULL
                """,
                (username, password_hash, role, serialized_scopes, now_ts, now_ts),
            )

    def create_user(self, username: str, password: str, role: str, scopes: list[str]) -> UserRecord | None:
        now_ts = int(_now_utc().timestamp())
        serialized_scopes = _serialize_scopes(scopes)
        password_hash = _hash_password(password)
        with self._lock, self._conn:
            existing = self._conn.execute(
                "SELECT username FROM users WHERE username = ?",
                (username,),
            ).fetchone()
            if existing:
                return None

            self._conn.execute(
                """
                INSERT INTO users(username, password_hash, role, scopes, created_at, updated_at, disabled_at)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
                """,
                (username, password_hash, role, serialized_scopes, now_ts, now_ts),
            )
            row = self._conn.execute(
                """
                SELECT username, role, scopes
                FROM users
                WHERE username = ? AND disabled_at IS NULL
                """,
                (username,),
            ).fetchone()

        if not row:
            return None
        return self._deserialize_user(row)

    def authenticate_user(self, username: str, password: str) -> UserRecord | None:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT username, password_hash, role, scopes
                FROM users
                WHERE username = ? AND disabled_at IS NULL
                """,
                (username,),
            ).fetchone()

        if not row:
            return None

        if not _verify_password(password, str(row["password_hash"])):
            return None
        return self._deserialize_user(row)

    def prune_expired(self) -> None:
        now_ts = int(_now_utc().timestamp())
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now_ts,))

    def create_session(
        self,
        session_id: str,
        subject: str,
        role: str,
        scopes: list[str],
        refresh_jti: str,
        expires_at: int,
    ) -> None:
        now_ts = int(_now_utc().timestamp())
        serialized_scopes = _serialize_scopes(scopes)
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO sessions(
                    session_id, subject, role, scopes, refresh_jti_hash,
                    created_at, expires_at, rotated_at, revoked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                """,
                (
                    session_id,
                    subject,
                    role,
                    serialized_scopes,
                    _token_hash(refresh_jti),
                    now_ts,
                    expires_at,
                ),
            )

    def get_active_session(self, session_id: str, subject: str) -> SessionRecord | None:
        now_ts = int(_now_utc().timestamp())
        with self._lock:
            row = self._conn.execute(
                """
                SELECT session_id, subject, role, scopes, expires_at
                FROM sessions
                WHERE session_id = ? AND subject = ? AND revoked_at IS NULL AND expires_at > ?
                """,
                (session_id, subject, now_ts),
            ).fetchone()
        if not row:
            return None
        return self._deserialize_session(row)

    def rotate_refresh(
        self,
        session_id: str,
        subject: str,
        current_refresh_jti: str,
        next_refresh_jti: str,
        next_expires_at: int,
    ) -> SessionRecord | None:
        now_ts = int(_now_utc().timestamp())
        with self._lock, self._conn:
            row = self._conn.execute(
                """
                SELECT session_id, subject, role, scopes, expires_at, refresh_jti_hash, revoked_at
                FROM sessions
                WHERE session_id = ? AND subject = ?
                """,
                (session_id, subject),
            ).fetchone()
            if not row:
                return None
            if row["revoked_at"] is not None or int(row["expires_at"]) <= now_ts:
                return None
            if not secrets.compare_digest(str(row["refresh_jti_hash"]), _token_hash(current_refresh_jti)):
                return None

            self._conn.execute(
                """
                UPDATE sessions
                SET refresh_jti_hash = ?, expires_at = ?, rotated_at = ?
                WHERE session_id = ? AND subject = ?
                """,
                (_token_hash(next_refresh_jti), next_expires_at, now_ts, session_id, subject),
            )
            return self._deserialize_session(row)

    def revoke_session(self, session_id: str, subject: str, refresh_jti: str) -> bool:
        now_ts = int(_now_utc().timestamp())
        with self._lock, self._conn:
            row = self._conn.execute(
                """
                SELECT refresh_jti_hash, revoked_at, expires_at
                FROM sessions
                WHERE session_id = ? AND subject = ?
                """,
                (session_id, subject),
            ).fetchone()
            if not row:
                return False
            if row["revoked_at"] is not None or int(row["expires_at"]) <= now_ts:
                return False
            if not secrets.compare_digest(str(row["refresh_jti_hash"]), _token_hash(refresh_jti)):
                return False

            self._conn.execute(
                "UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND subject = ?",
                (now_ts, session_id, subject),
            )
            return True


_session_store: SessionStore | None = None
_session_store_path: str | None = None
_session_store_lock = threading.Lock()


def get_session_store(settings: Settings) -> SessionStore:
    global _session_store, _session_store_path
    with _session_store_lock:
        if _session_store is None or _session_store_path != settings.jwt_session_db_path:
            if _session_store is not None:
                _session_store.close()
            _session_store = SessionStore(settings.jwt_session_db_path)
            _session_store_path = settings.jwt_session_db_path
        return _session_store


def close_auth_resources() -> None:
    global _session_store, _session_store_path
    with _session_store_lock:
        if _session_store is not None:
            _session_store.close()
            _session_store = None
            _session_store_path = None


def _ensure_bootstrap_user(settings: Settings) -> None:
    try:
        username = normalize_username(settings.auth_username)
    except ValueError:
        return
    if not settings.auth_password:
        return
    role = settings.auth_role.strip() or "admin"
    scopes = _parse_scopes(settings.auth_scopes)
    if not scopes:
        scopes = ["chat:write", "chat:stream"]
    store = get_session_store(settings)
    store.upsert_user(username, settings.auth_password, role=role, scopes=scopes)


def authenticate_user_credentials(
    provided_username: str,
    provided_password: str,
    settings: Settings,
) -> UserRecord | None:
    _ensure_bootstrap_user(settings)
    try:
        normalized = normalize_username(provided_username)
    except ValueError:
        return None
    if not provided_password:
        return None
    store = get_session_store(settings)
    return store.authenticate_user(normalized, provided_password)


def register_user_account(username: str, password: str, settings: Settings) -> UserRecord:
    if not settings.auth_allow_self_signup:
        raise HTTPException(status_code=403, detail="Self-signup is disabled.")

    normalized_username = normalize_username(username)
    _validate_password_policy(password, settings)

    role = settings.auth_register_default_role.strip() or "user"
    scopes = _parse_scopes(settings.auth_register_default_scopes)
    if not scopes:
        scopes = ["chat:write", "chat:stream"]

    _ensure_bootstrap_user(settings)
    store = get_session_store(settings)
    created = store.create_user(normalized_username, password, role=role, scopes=scopes)
    if not created:
        raise HTTPException(status_code=409, detail="Username already exists.")
    return created


def is_login_valid(provided_username: str, provided_password: str, settings: Settings) -> bool:
    return authenticate_user_credentials(provided_username, provided_password, settings) is not None


def _encode_token(claims: dict[str, Any], settings: Settings) -> str:
    return jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _create_access_token(
    *,
    subject: str,
    role: str,
    scopes: list[str],
    session_id: str,
    settings: Settings,
) -> tuple[str, int]:
    now = _now_utc()
    expires_at = now + timedelta(minutes=settings.jwt_access_token_expires_minutes)
    claims: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "scp": scopes,
        "sid": session_id,
        "typ": "access",
        "jti": str(uuid4()),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return _encode_token(claims, settings), int((expires_at - now).total_seconds())


def _create_refresh_token(
    *,
    subject: str,
    session_id: str,
    refresh_jti: str,
    settings: Settings,
) -> tuple[str, int, int]:
    now = _now_utc()
    expires_at = now + timedelta(days=settings.jwt_refresh_token_expires_days)
    claims: dict[str, Any] = {
        "sub": subject,
        "sid": session_id,
        "typ": "refresh",
        "jti": refresh_jti,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return (
        _encode_token(claims, settings),
        int((expires_at - now).total_seconds()),
        int(expires_at.timestamp()),
    )


def issue_token_pair(
    subject: str,
    settings: Settings,
    *,
    role: str | None = None,
    scopes: list[str] | None = None,
) -> TokenPair:
    resolved_role = (role or settings.auth_role).strip() or "user"
    resolved_scopes = scopes or _parse_scopes(settings.auth_scopes)
    if not resolved_scopes:
        resolved_scopes = ["chat:write", "chat:stream"]

    session_id = str(uuid4())
    refresh_jti = str(uuid4())
    refresh_token, refresh_expires_in, refresh_expires_at = _create_refresh_token(
        subject=subject,
        session_id=session_id,
        refresh_jti=refresh_jti,
        settings=settings,
    )
    access_token, access_expires_in = _create_access_token(
        subject=subject,
        role=resolved_role,
        scopes=resolved_scopes,
        session_id=session_id,
        settings=settings,
    )

    store = get_session_store(settings)
    store.prune_expired()
    store.create_session(
        session_id=session_id,
        subject=subject,
        role=resolved_role,
        scopes=resolved_scopes,
        refresh_jti=refresh_jti,
        expires_at=refresh_expires_at,
    )
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=access_expires_in,
        refresh_expires_in=refresh_expires_in,
        role=resolved_role,
        scopes=resolved_scopes,
    )


def _decode_jwt(token: str, settings: Settings) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            leeway=settings.jwt_clock_skew_seconds,
        )
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid bearer token.") from exc
    return payload


def extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None
    parts = auth_header.split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != "bearer":
        return None
    return token.strip() or None


def _validate_refresh_token(refresh_token: str, settings: Settings) -> dict[str, Any]:
    payload = _decode_jwt(refresh_token, settings)
    if str(payload.get("typ", "")).strip() != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token.")
    subject = str(payload.get("sub", "")).strip()
    session_id = str(payload.get("sid", "")).strip()
    jti = str(payload.get("jti", "")).strip()
    if not subject or not session_id or not jti:
        raise HTTPException(status_code=401, detail="Invalid refresh token.")
    return payload


def refresh_token_pair(refresh_token: str, settings: Settings) -> TokenPair:
    payload = _validate_refresh_token(refresh_token, settings)
    subject = str(payload["sub"])
    session_id = str(payload["sid"])
    refresh_jti = str(payload["jti"])

    next_refresh_jti = str(uuid4())
    next_refresh_token, refresh_expires_in, refresh_expires_at = _create_refresh_token(
        subject=subject,
        session_id=session_id,
        refresh_jti=next_refresh_jti,
        settings=settings,
    )

    store = get_session_store(settings)
    store.prune_expired()
    session = store.rotate_refresh(
        session_id=session_id,
        subject=subject,
        current_refresh_jti=refresh_jti,
        next_refresh_jti=next_refresh_jti,
        next_expires_at=refresh_expires_at,
    )
    if not session:
        raise HTTPException(status_code=401, detail="Refresh token is invalid or expired.")

    access_token, access_expires_in = _create_access_token(
        subject=subject,
        role=session.role,
        scopes=session.scopes,
        session_id=session.session_id,
        settings=settings,
    )
    return TokenPair(
        access_token=access_token,
        refresh_token=next_refresh_token,
        expires_in=access_expires_in,
        refresh_expires_in=refresh_expires_in,
        role=session.role,
        scopes=session.scopes,
    )


def revoke_refresh_session(refresh_token: str, settings: Settings) -> None:
    payload = _validate_refresh_token(refresh_token, settings)
    subject = str(payload["sub"])
    session_id = str(payload["sid"])
    refresh_jti = str(payload["jti"])

    store = get_session_store(settings)
    store.prune_expired()
    revoked = store.revoke_session(session_id=session_id, subject=subject, refresh_jti=refresh_jti)
    if not revoked:
        raise HTTPException(status_code=401, detail="Refresh token is invalid or expired.")


def validate_bearer_token(
    request: Request,
    settings: Settings,
    required_scopes: set[str] | None = None,
) -> AuthIdentity:
    token = extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    payload = _decode_jwt(token, settings)
    if str(payload.get("typ", "")).strip() != "access":
        raise HTTPException(status_code=401, detail="Invalid bearer token.")

    subject = str(payload.get("sub", "")).strip()
    session_id = str(payload.get("sid", "")).strip()
    if not subject or not session_id:
        raise HTTPException(status_code=401, detail="Invalid bearer token.")

    store = get_session_store(settings)
    session = store.get_active_session(session_id=session_id, subject=subject)
    if not session:
        raise HTTPException(status_code=401, detail="Session is not active.")

    identity = AuthIdentity(
        subject=subject,
        role=session.role,
        scopes=frozenset(session.scopes),
        session_id=session_id,
        auth_type="jwt",
    )
    if required_scopes:
        missing = sorted(required_scopes - set(identity.scopes))
        if missing:
            raise HTTPException(status_code=403, detail=f"Insufficient scope: {', '.join(missing)}")
    return identity


def validate_request_auth(
    request: Request,
    settings: Settings,
    required_scopes: set[str] | None = None,
) -> AuthIdentity:
    return validate_bearer_token(request, settings, required_scopes=required_scopes)
