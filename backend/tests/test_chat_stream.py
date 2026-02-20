from fastapi.testclient import TestClient

from app import main


def test_chat_stream_requires_bearer_token() -> None:
    client = TestClient(main.app)
    response = client.post(
        "/api/chat/stream",
        json={"prompt": "hello", "max_output_tokens": 64},
    )
    assert response.status_code == 401


def test_chat_stream_yields_data(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "auth_username", "alice")
    monkeypatch.setattr(main.settings, "auth_password", "secret-pass")
    monkeypatch.setattr(main.settings, "jwt_secret", "test-secret")
    monkeypatch.setattr(main.settings, "jwt_issuer", "issuer")
    monkeypatch.setattr(main.settings, "jwt_audience", "audience")
    monkeypatch.setattr(main.settings, "jwt_access_token_expires_minutes", 30)

    async def fake_generate_stream(_prompt: str, _max_output_tokens: int):
        yield "hello "
        yield "world"

    monkeypatch.setattr(main.llm_service, "generate_stream", fake_generate_stream)

    client = TestClient(main.app)
    login = client.post(
        "/auth/login",
        json={"username": "alice", "password": "secret-pass"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    response = client.post(
        "/api/chat/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={"prompt": "hello", "max_output_tokens": 64},
    )
    assert response.status_code == 200
    assert '"delta": "hello "' in response.text
    assert '"delta": "world"' in response.text
    assert '"done": true' in response.text
