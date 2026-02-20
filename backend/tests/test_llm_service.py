import asyncio

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.llm_service import LLMService


def test_generate_includes_ollama_error_detail() -> None:
    class FakeResponse:
        status_code = 404

        @staticmethod
        def json() -> dict[str, str]:
            return {"error": "model 'llama3.2:3b' not found"}

    class FakeClient:
        async def post(self, _url: str, json: dict) -> FakeResponse:  # noqa: A002
            assert json["keep_alive"] == "10m"
            return FakeResponse()

        async def aclose(self) -> None:
            return None

    service = LLMService(Settings())
    service._client = FakeClient()  # noqa: SLF001

    with pytest.raises(HTTPException) as exc:
        asyncio.run(service.generate("hello", 64))

    assert exc.value.status_code == 502
    assert "status 404" in str(exc.value.detail)
    assert "model 'llama3.2:3b' not found" in str(exc.value.detail)


def test_generate_stream_yields_chunks() -> None:
    class FakeResponse:
        status_code = 200

        @staticmethod
        async def aiter_lines():
            yield '{"response":"Hel","done":false}'
            yield '{"response":"lo","done":false}'
            yield '{"done":true}'

    class FakeStreamContext:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, _exc_type, _exc, _tb) -> None:
            return None

    class FakeClient:
        def stream(self, _method: str, _url: str, json: dict):
            assert json["stream"] is True
            return FakeStreamContext()

        async def aclose(self) -> None:
            return None

    async def collect() -> list[str]:
        service = LLMService(Settings())
        service._client = FakeClient()  # noqa: SLF001
        return [chunk async for chunk in service.generate_stream("hello", 64)]

    chunks = asyncio.run(collect())
    assert chunks == ["Hel", "lo"]
