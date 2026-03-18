from fastapi.testclient import TestClient
import pyotp

from app import main


def test_register_creates_account_and_returns_jwt(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "auth_allow_self_signup", True)
    monkeypatch.setattr(main.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(main.settings, "jwt_issuer", "issuer")
    monkeypatch.setattr(main.settings, "jwt_audience", "audience")

    client = TestClient(main.app)
    response = client.post(
        "/auth/register",
        json={"username": "bob", "password": "StrongPass123"},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["access_token"]
    assert payload["refresh_token"]


def test_register_rejects_duplicate_username(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "auth_allow_self_signup", True)
    monkeypatch.setattr(main.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(main.settings, "jwt_issuer", "issuer")
    monkeypatch.setattr(main.settings, "jwt_audience", "audience")

    client = TestClient(main.app)
    first = client.post("/auth/register", json={"username": "bob", "password": "StrongPass123"})
    assert first.status_code == 201

    second = client.post("/auth/register", json={"username": "bob", "password": "StrongPass123"})
    assert second.status_code == 409


def test_login_requires_mfa_code_when_enabled(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "auth_allow_self_signup", True)
    monkeypatch.setattr(main.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(main.settings, "jwt_issuer", "issuer")
    monkeypatch.setattr(main.settings, "jwt_audience", "audience")

    client = TestClient(main.app)
    register = client.post("/auth/register", json={"username": "bob", "password": "StrongPass123"})
    assert register.status_code == 201
    token = register.json()["access_token"]

    setup = client.post("/auth/2fa/setup", headers={"Authorization": f"Bearer {token}"})
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    code = pyotp.TOTP(secret).now()
    enable = client.post("/auth/2fa/enable", headers={"Authorization": f"Bearer {token}"}, json={"otp_code": code})
    assert enable.status_code == 200

    login_without_code = client.post("/auth/login", json={"username": "bob", "password": "StrongPass123"})
    assert login_without_code.status_code == 401
    assert login_without_code.json()["detail"] == "MFA code required."

    login_with_code = client.post(
        "/auth/login",
        json={"username": "bob", "password": "StrongPass123", "otp_code": pyotp.TOTP(secret).now()},
    )
    assert login_with_code.status_code == 200
    assert login_with_code.json()["access_token"]


def test_mfa_status_requires_bearer_token() -> None:
    client = TestClient(main.app)
    response = client.get("/auth/2fa/status")
    assert response.status_code == 401


def test_login_rejects_invalid_credentials(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "auth_username", "admin")
    monkeypatch.setattr(main.settings, "auth_password", "correct-password")
    client = TestClient(main.app)
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "wrong-password"},
    )
    assert response.status_code == 401


def test_chat_requires_bearer_token() -> None:
    client = TestClient(main.app)
    response = client.post("/api/chat", json={"prompt": "hello", "max_output_tokens": 64})
    assert response.status_code == 401


def test_chat_rejects_invalid_bearer_token(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(main.settings, "jwt_issuer", "issuer")
    monkeypatch.setattr(main.settings, "jwt_audience", "audience")

    client = TestClient(main.app)
    response = client.post(
        "/api/chat",
        headers={"Authorization": "Bearer definitely-invalid-token"},
        json={"prompt": "hello", "max_output_tokens": 64},
    )
    assert response.status_code == 401


def test_login_and_chat_with_jwt(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "auth_username", "alice")
    monkeypatch.setattr(main.settings, "auth_password", "secret-pass")
    monkeypatch.setattr(main.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(main.settings, "jwt_issuer", "issuer")
    monkeypatch.setattr(main.settings, "jwt_audience", "audience")
    monkeypatch.setattr(main.settings, "jwt_access_token_expires_minutes", 30)

    async def fake_generate(_prompt: str, _max_output_tokens: int) -> str:
        return "ok"

    monkeypatch.setattr(main.llm_service, "generate", fake_generate)

    client = TestClient(main.app)
    login_response = client.post(
        "/auth/login",
        json={"username": "alice", "password": "secret-pass"},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    assert login_response.json()["refresh_token"]

    chat_response = client.post(
        "/api/chat",
        headers={"Authorization": f"Bearer {token}"},
        json={"prompt": "hello", "max_output_tokens": 64},
    )
    assert chat_response.status_code == 200


def test_refresh_rotates_and_rejects_old_refresh_token(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "auth_username", "alice")
    monkeypatch.setattr(main.settings, "auth_password", "secret-pass")
    monkeypatch.setattr(main.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(main.settings, "jwt_issuer", "issuer")
    monkeypatch.setattr(main.settings, "jwt_audience", "audience")

    client = TestClient(main.app)
    login_response = client.post(
        "/auth/login",
        json={"username": "alice", "password": "secret-pass"},
    )
    assert login_response.status_code == 200
    old_refresh = login_response.json()["refresh_token"]

    refresh_response = client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert refresh_response.status_code == 200
    assert refresh_response.json()["refresh_token"] != old_refresh

    replay_response = client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert replay_response.status_code == 401


def test_logout_revokes_session_for_access_token(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "auth_username", "alice")
    monkeypatch.setattr(main.settings, "auth_password", "secret-pass")
    monkeypatch.setattr(main.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(main.settings, "jwt_issuer", "issuer")
    monkeypatch.setattr(main.settings, "jwt_audience", "audience")

    async def fake_generate(_prompt: str, _max_output_tokens: int) -> str:
        return "ok"

    monkeypatch.setattr(main.llm_service, "generate", fake_generate)

    client = TestClient(main.app)
    login_response = client.post(
        "/auth/login",
        json={"username": "alice", "password": "secret-pass"},
    )
    assert login_response.status_code == 200
    access_token = login_response.json()["access_token"]
    refresh_token = login_response.json()["refresh_token"]

    logout_response = client.post("/auth/logout", json={"refresh_token": refresh_token})
    assert logout_response.status_code == 200

    chat_response = client.post(
        "/api/chat",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"prompt": "hello", "max_output_tokens": 64},
    )
    assert chat_response.status_code == 401


def test_stream_requires_chat_stream_scope(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "auth_username", "alice")
    monkeypatch.setattr(main.settings, "auth_password", "secret-pass")
    monkeypatch.setattr(main.settings, "auth_scopes", "chat:write")
    monkeypatch.setattr(main.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(main.settings, "jwt_issuer", "issuer")
    monkeypatch.setattr(main.settings, "jwt_audience", "audience")

    client = TestClient(main.app)
    login_response = client.post(
        "/auth/login",
        json={"username": "alice", "password": "secret-pass"},
    )
    assert login_response.status_code == 200
    access_token = login_response.json()["access_token"]

    stream_response = client.post(
        "/api/chat/stream",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"prompt": "hello", "max_output_tokens": 64},
    )
    assert stream_response.status_code == 403
