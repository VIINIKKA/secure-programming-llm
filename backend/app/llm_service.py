import httpx
from fastapi import HTTPException

from app.config import Settings


class LLMService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def generate(self, prompt: str, max_output_tokens: int) -> str:
        payload = {
            "model": self._settings.ollama_model,
            "prompt": prompt,
            "system": self._settings.system_prompt,
            "stream": False,
            "options": {"num_predict": min(max_output_tokens, self._settings.max_output_tokens)},
        }
        url = f"{self._settings.ollama_base_url.rstrip('/')}/api/generate"
        timeout = self._settings.request_timeout_seconds

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, json=payload)
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=504, detail="LLM timeout.") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Failed to contact LLM service.") from exc

        if response.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"LLM service returned status {response.status_code}.",
            )

        data = response.json()
        answer = str(data.get("response", "")).strip()
        if not answer:
            raise HTTPException(status_code=502, detail="LLM returned an empty response.")
        return answer
