import asyncio

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.llm_service import LLMService


def test_generate_includes_ollama_error_detail(monkeypatch) -> None:
    class FakeResponse:
        status_code = 404

        @staticmethod
        def json() -> dict[str, str]:
            return {"error": "model 'mistral' not found"}

    class FakeClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _tb) -> None:
            return None

        async def post(self, _url: str, json: dict) -> FakeResponse:  # noqa: A002
            return FakeResponse()

    monkeypatch.setattr("app.llm_service.httpx.AsyncClient", FakeClient)

    service = LLMService(Settings())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(service.generate("hello", 64))

    assert exc.value.status_code == 502
    assert "status 404" in str(exc.value.detail)
    assert "model 'mistral' not found" in str(exc.value.detail)
