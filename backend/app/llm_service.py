import json
from collections.abc import AsyncIterator

import httpx
from fastapi import HTTPException

from app.config import Settings


class LLMService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        timeout = httpx.Timeout(float(settings.request_timeout_seconds))
        limits = httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=30)
        self._client = httpx.AsyncClient(timeout=timeout, limits=limits)

    async def aclose(self) -> None:
        await self._client.aclose()

    def _build_payload(self, prompt: str, max_output_tokens: int, stream: bool) -> dict:
        # Keep the final output cap on the backend side.
        return {
            "model": self._settings.ollama_model,
            "prompt": prompt,
            "system": self._settings.system_prompt,
            "stream": stream,
            "keep_alive": self._settings.ollama_keep_alive,
            "options": {"num_predict": min(max_output_tokens, self._settings.max_output_tokens)},
        }

    @property
    def _generate_url(self) -> str:
        return f"{self._settings.ollama_base_url.rstrip('/')}/api/generate"

    @staticmethod
    def _extract_error(response: httpx.Response) -> str:
        detail = f"LLM service returned status {response.status_code}."
        try:
            error_text = str(response.json().get("error", "")).strip()
            if error_text:
                detail = f"{detail} {error_text}"
        except ValueError:
            pass
        return detail

    async def generate(self, prompt: str, max_output_tokens: int) -> str:
        payload = self._build_payload(prompt, max_output_tokens, stream=False)
        try:
            response = await self._client.post(self._generate_url, json=payload)
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=504, detail="LLM timeout.") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Failed to contact LLM service.") from exc

        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=self._extract_error(response))

        data = response.json()
        answer = str(data.get("response", "")).strip()
        if not answer:
            raise HTTPException(status_code=502, detail="LLM returned an empty response.")
        return answer

    async def generate_stream(self, prompt: str, max_output_tokens: int) -> AsyncIterator[str]:
        payload = self._build_payload(prompt, max_output_tokens, stream=True)
        try:
            async with self._client.stream("POST", self._generate_url, json=payload) as response:
                if response.status_code >= 400:
                    raise HTTPException(status_code=502, detail=self._extract_error(response))

                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue

                    # Ollama streams one JSON object per line.
                    try:
                        part = json.loads(line)
                    except json.JSONDecodeError as exc:
                        raise HTTPException(status_code=502, detail="LLM stream returned invalid JSON.") from exc

                    error_text = str(part.get("error", "")).strip()
                    if error_text:
                        raise HTTPException(status_code=502, detail=f"LLM service error: {error_text}")

                    chunk = str(part.get("response", ""))
                    if chunk:
                        yield chunk

                    if part.get("done"):
                        break
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=504, detail="LLM timeout.") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Failed to contact LLM service.") from exc
