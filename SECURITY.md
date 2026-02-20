# Security Posture and OWASP Mapping

This document maps implemented controls to OWASP guidance and shows current gaps.

## Scope

In-scope components:
- `backend` (FastAPI security layer)
- `frontend` (Nginx + React client path to backend)
- CI checks visible in repository (`Jenkinsfile`, tests)

Primary backend entrypoint:
- `POST /api/chat`
- `POST /api/chat/stream`

## Threat Model (Current)

Main threats addressed:
- Prompt injection attempts
- Sensitive data disclosure (input/output/logging)
- Resource abuse (rate limits and token limits)
- Direct backend misuse (JWT access control)

Main residual risks:
- No RBAC yet (JWT identifies user but no role-based authorization policy enforced)
- No TLS termination configured in repository by default
- Limited protection against misinformation and advanced adversarial prompts

## OWASP Top 10 for LLM Applications (2025) Mapping

| OWASP ID | Status | Current Implementation | Code References |
|---|---|---|---|
| LLM01 Prompt Injection | Partial | Input sanitization and regex-based prompt-injection blocking. | `backend/app/security.py`, `backend/app/main.py` |
| LLM02 Sensitive Information Disclosure | Implemented (baseline) | PII redaction before LLM call, response redaction, sanitized/truncated logging. | `backend/app/security.py`, `backend/app/main.py` |
| LLM03 Supply Chain | Partial | Dependency scanning in pipeline (`pip-audit`, `npm audit`) and SAST (`bandit`). | `Jenkinsfile`, `backend/requirements.txt` |
| LLM04 Data and Model Poisoning | Not Implemented | No data ingestion/training pipeline controls in current app. | N/A |
| LLM05 Improper Output Handling | Partial | Response treated as plain text in UI; no HTML rendering/eval path. Limited structured-output validation. | `frontend/src/App.jsx`, `backend/app/main.py` |
| LLM06 Excessive Agency | Implemented (by architecture) | No tool calling, no external action execution from model outputs. | `backend/app/llm_service.py` |
| LLM07 System Prompt Leakage | Partial | System prompt constraints + pattern blocking for prompt-leak attempts. Not formally robust against advanced jailbreaks. | `backend/app/config.py`, `backend/app/security.py` |
| LLM08 Vector and Embedding Weaknesses | Not Applicable (current) | No vector DB / RAG pipeline currently implemented. | N/A |
| LLM09 Misinformation | Not Implemented | No fact-checking/citation or confidence controls. | N/A |
| LLM10 Unbounded Consumption | Implemented (baseline) | Rate limiting, input token limit, output token cap, request timeout. | `backend/app/main.py`, `backend/app/config.py`, `backend/app/llm_service.py` |

## Additional Security Controls (Non-OWASP-LLM Specific)

- Request validation with Pydantic schema constraints
  - `backend/app/main.py`
- CORS allowlist from configuration
  - `backend/app/main.py`, `backend/app/config.py`
- JWT auth on `/auth/login` + bearer token validation for `/api/chat` and `/api/chat/stream`
  - `backend/app/auth.py`, `backend/app/main.py`, `.env.example`
- Container runtime hardening on app services
  - `docker-compose.yml`, `backend/Dockerfile`
- Repository dependency update automation (Dependabot)
  - `.github/dependabot.yml`
- Integration and unit tests for security-critical behavior
  - `backend/tests/test_security.py`, `backend/tests/test_auth.py`, `backend/tests/test_api_auth.py`

## Verification Checklist

Run backend tests:

```bash
pytest -q backend/tests
```

Expected security checks include:
- prompt sanitization tests
- PII redaction tests
- JWT login and bearer-token behavior tests

Pipeline-level checks (from `Jenkinsfile`):
- `bandit -q -r backend/app`
- `pip-audit -r backend/requirements.txt`
- `npm audit --audit-level=high`

## Known Gaps and Future Work

1. Add refresh-token flow and role-based authorization (current JWT implementation is access-token-only).
2. Add TLS termination and hardened reverse proxy configuration.
3. Strengthen prompt-injection defense beyond regex (classifier/rules layering).
4. Extend container hardening coverage to all services and pin production image versions/digests.
5. Expand security testing (integration abuse scenarios, DAST, fuzzing).
