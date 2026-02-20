from fastapi.testclient import TestClient

from app import main


def test_chat_requires_api_key_when_configured(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "api_key", "top-secret")

    client = TestClient(main.app)
    response = client.post(
        "/api/chat",
        json={"prompt": "hello", "max_output_tokens": 64},
    )
    assert response.status_code == 401


def test_chat_accepts_valid_api_key(monkeypatch) -> None:
    monkeypatch.setattr(main.settings, "api_key", "top-secret")

    async def fake_generate(_prompt: str, _max_output_tokens: int) -> str:
        return "ok"

    monkeypatch.setattr(main.llm_service, "generate", fake_generate)

    client = TestClient(main.app)
    response = client.post(
        "/api/chat",
        headers={"X-API-Key": "top-secret"},
        json={"prompt": "hello", "max_output_tokens": 64},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["response"] == "ok"
