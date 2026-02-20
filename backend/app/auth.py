import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import HTTPException, Request
from jwt import InvalidTokenError

from app.config import Settings

def is_api_key_valid(provided_key: str | None, expected_key: str) -> bool:
    if not expected_key:
        return True
    if not provided_key:
        return False
    return secrets.compare_digest(provided_key, expected_key)


@dataclass(frozen=True)
class AuthIdentity:
    subject: str
    auth_type: str


def is_login_valid(provided_username: str, provided_password: str, settings: Settings) -> bool:
    return secrets.compare_digest(provided_username, settings.auth_username) and secrets.compare_digest(
        provided_password,
        settings.auth_password,
    )


def create_access_token(subject: str, settings: Settings) -> str:
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.jwt_access_token_expires_minutes)
    claims: dict[str, Any] = {
        "sub": subject,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)


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


def validate_bearer_token(request: Request, settings: Settings) -> AuthIdentity:
    token = extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
        )
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid bearer token.") from exc

    subject = str(payload.get("sub", "")).strip()
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid bearer token.")

    return AuthIdentity(subject=subject, auth_type="jwt")


def validate_request_auth(request: Request, settings: Settings) -> AuthIdentity:
    mode = settings.auth_mode.strip().lower()

    if mode not in {"api_key", "jwt", "hybrid"}:
        raise HTTPException(status_code=500, detail="Invalid auth mode configuration.")

    if mode == "api_key":
        if not is_api_key_valid(
            request.headers.get(settings.api_key_header_name),
            settings.api_key,
        ):
            raise HTTPException(status_code=401, detail="Unauthorized.")
        return AuthIdentity(subject="api-key-client", auth_type="api_key")

    if mode == "jwt":
        return validate_bearer_token(request, settings)

    # hybrid mode: allow either valid JWT or valid API key.
    bearer_token = extract_bearer_token(request)
    if bearer_token:
        return validate_bearer_token(request, settings)

    if is_api_key_valid(
        request.headers.get(settings.api_key_header_name),
        settings.api_key,
    ):
        return AuthIdentity(subject="api-key-client", auth_type="api_key")

    raise HTTPException(status_code=401, detail="Unauthorized.")
