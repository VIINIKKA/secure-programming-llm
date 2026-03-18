from fastapi import HTTPException
import pytest

from app.auth import authenticate_user_credentials, register_user_account
from app.config import Settings


def test_bootstrap_user_login_is_valid(tmp_path) -> None:
    settings = Settings(
        auth_username="alice",
        auth_password="Passw0rd123",
        jwt_session_db_path=str(tmp_path / "auth_sessions.db"),
    )
    user = authenticate_user_credentials("alice", "Passw0rd123", settings)
    assert user is not None
    assert user.username == "alice"


def test_bootstrap_user_login_rejects_invalid_password(tmp_path) -> None:
    settings = Settings(
        auth_username="alice",
        auth_password="Passw0rd123",
        jwt_session_db_path=str(tmp_path / "auth_sessions.db"),
    )
    user = authenticate_user_credentials("alice", "wrong-password", settings)
    assert user is None


def test_register_user_account_and_authenticate(tmp_path) -> None:
    settings = Settings(
        auth_username="admin",
        auth_password="Adm1nPass123",
        auth_allow_self_signup=True,
        auth_register_default_role="user",
        auth_register_default_scopes="chat:write chat:stream",
        jwt_session_db_path=str(tmp_path / "auth_sessions.db"),
    )
    created = register_user_account("bob", "Secure12345", settings)
    assert created.username == "bob"
    assert created.role == "user"

    authenticated = authenticate_user_credentials("bob", "Secure12345", settings)
    assert authenticated is not None
    assert authenticated.username == "bob"


def test_register_user_rejects_duplicate_username(tmp_path) -> None:
    settings = Settings(
        auth_username="admin",
        auth_password="Adm1nPass123",
        auth_allow_self_signup=True,
        jwt_session_db_path=str(tmp_path / "auth_sessions.db"),
    )
    register_user_account("bob", "Secure12345", settings)
    with pytest.raises(HTTPException) as exc:
        register_user_account("bob", "Secure12345", settings)
    assert exc.value.status_code == 409


def test_register_user_rejects_weak_password(tmp_path) -> None:
    settings = Settings(
        auth_username="admin",
        auth_password="Adm1nPass123",
        auth_allow_self_signup=True,
        auth_min_password_length=10,
        jwt_session_db_path=str(tmp_path / "auth_sessions.db"),
    )
    with pytest.raises(ValueError):
        register_user_account("bob", "short", settings)
