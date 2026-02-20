import logging
import json
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.auth import create_access_token, is_login_valid, validate_request_auth
from app.config import settings
from app.llm_service import LLMService
from app.security import (
    approx_token_count,
    is_prompt_injection,
    redact_pii,
    sanitize_for_log,
    sanitize_input,
)

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("secure-llm-backend")

limiter = Limiter(key_func=get_remote_address, default_limits=[settings.rate_limit])
llm_service = LLMService(settings)

app = FastAPI(title=settings.app_name)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=12000)
    max_output_tokens: int | None = Field(default=None, ge=32, le=2048)


class ChatResponse(BaseModel):
    response: str
    pii_redacted: bool
    input_tokens: int


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=200)
    password: str = Field(..., min_length=1, max_length=200)


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await llm_service.aclose()


@app.post("/auth/login", response_model=LoginResponse)
@limiter.limit(settings.rate_limit)
async def login(body: LoginRequest, request: Request) -> LoginResponse:
    if not is_login_valid(body.username, body.password, settings):
        logger.warning("failed login attempt client=%s user=%s", get_remote_address(request), body.username)
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    token = create_access_token(subject=body.username, settings=settings)
    expires_in = settings.jwt_access_token_expires_minutes * 60
    return LoginResponse(access_token=token, expires_in=expires_in)


def _prepare_chat_context(body: ChatRequest, request: Request) -> dict:
    client_ip = get_remote_address(request)
    identity = validate_request_auth(request, settings)

    try:
        cleaned = sanitize_input(body.prompt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if settings.block_prompt_injection and is_prompt_injection(cleaned):
        logger.warning(
            "blocked prompt injection client=%s prompt=%s",
            client_ip,
            sanitize_for_log(cleaned),
        )
        raise HTTPException(status_code=400, detail="Prompt rejected by security policy.")

    sanitized_input = cleaned
    pii_redacted = False
    if settings.redact_pii:
        sanitized_input, pii_redacted = redact_pii(sanitized_input)

    token_count = approx_token_count(sanitized_input)
    if token_count > settings.max_input_tokens:
        raise HTTPException(
            status_code=400,
            detail=f"Input too large. Approx tokens {token_count} exceed limit {settings.max_input_tokens}.",
        )

    logger.info(
        "chat request accepted client=%s subject=%s auth=%s tokens=%s pii_redacted=%s",
        client_ip,
        identity.subject,
        identity.auth_type,
        token_count,
        pii_redacted,
    )

    return {
        "client_ip": client_ip,
        "sanitized_input": sanitized_input,
        "token_count": token_count,
        "pii_redacted": pii_redacted,
        "output_tokens": body.max_output_tokens or settings.max_output_tokens,
    }


@app.post("/api/chat", response_model=ChatResponse)
@limiter.limit(settings.rate_limit)
async def chat(body: ChatRequest, request: Request) -> ChatResponse:
    context = _prepare_chat_context(body, request)

    llm_response = await llm_service.generate(context["sanitized_input"], context["output_tokens"])

    safe_response = llm_response
    if settings.redact_pii:
        safe_response, _ = redact_pii(safe_response)

    logger.info("chat response delivered client=%s chars=%s", context["client_ip"], len(safe_response))
    return ChatResponse(
        response=safe_response,
        pii_redacted=context["pii_redacted"],
        input_tokens=context["token_count"],
    )


@app.post("/api/chat/stream")
@limiter.limit(settings.rate_limit)
async def chat_stream(body: ChatRequest, request: Request) -> StreamingResponse:
    context = _prepare_chat_context(body, request)

    async def stream_events():
        full_response: list[str] = []
        try:
            async for chunk in llm_service.generate_stream(context["sanitized_input"], context["output_tokens"]):
                full_response.append(chunk)
                # Best-effort redaction per chunk; whole-response redaction is still performed for summary metadata.
                safe_chunk = chunk
                if settings.redact_pii:
                    safe_chunk, _ = redact_pii(safe_chunk)
                if safe_chunk:
                    yield f"data: {json.dumps({'delta': safe_chunk})}\n\n"
        except HTTPException as exc:
            yield f"data: {json.dumps({'error': str(exc.detail)})}\n\n"
            return

        combined = "".join(full_response)
        if settings.redact_pii:
            combined, _ = redact_pii(combined)

        logger.info("chat stream delivered client=%s chars=%s", context["client_ip"], len(combined))
        yield (
            "data: "
            + json.dumps(
                {
                    "done": True,
                    "input_tokens": context["token_count"],
                    "pii_redacted": context["pii_redacted"],
                }
            )
            + "\n\n"
        )

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
