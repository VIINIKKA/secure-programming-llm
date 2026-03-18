from fastapi import HTTPException
import pytest
import pyotp

from app.auth import (
    authenticate_user_credentials,
    begin_mfa_setup,
    disable_mfa_for_user,
    enable_mfa_for_user,
    get_user_mfa_state,
    register_user_account,
    verify_user_mfa_code,
)
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


def test_totp_mfa_enable_verify_disable_flow(tmp_path) -> None:
    settings = Settings(
        auth_username="admin",
        auth_password="Adm1nPass123",
        auth_allow_self_signup=True,
        jwt_session_db_path=str(tmp_path / "auth_sessions.db"),
    )
    register_user_account("bob", "Secure12345", settings)

    secret, _ = begin_mfa_setup("bob", settings)
    code = pyotp.TOTP(secret).now()
    enable_mfa_for_user("bob", code, settings)

    state = get_user_mfa_state("bob", settings)
    assert state["mfa_enabled"] is True
    assert verify_user_mfa_code("bob", code, settings)

    disable_mfa_for_user("bob", code, settings)
    state_after = get_user_mfa_state("bob", settings)
    assert state_after["mfa_enabled"] is False
