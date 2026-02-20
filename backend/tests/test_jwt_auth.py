from fastapi.testclient import TestClient

from app import main


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

    chat_response = client.post(
        "/api/chat",
        headers={"Authorization": f"Bearer {token}"},
        json={"prompt": "hello", "max_output_tokens": 64},
    )
    assert chat_response.status_code == 200
