# Hardening Status (Current Baseline)

This document summarizes security hardening that is currently implemented in the repository and ready to demonstrate.

Last updated: 2026-02-20

## 1. Scope

In-scope components:
- `backend` (FastAPI security layer)
- `frontend` (React UI served by Nginx)
- Runtime/deployment config (`docker-compose.yml`, Dockerfiles, Jenkins pipeline)
- Security docs and tests in repo

## 2. Implemented Hardening

### 2.1 Backend Application Security

- Input sanitization and prompt-injection pattern blocking
  - `backend/app/security.py`
  - `backend/app/main.py`
- PII redaction (request handling, response handling, and log-safe sanitization)
  - `backend/app/security.py`
  - `backend/app/main.py`
- Request validation with Pydantic models
  - `backend/app/main.py`
- Resource guardrails:
  - Rate limit (`RATE_LIMIT`)
  - Input token cap (`MAX_INPUT_TOKENS`)
  - Output token cap (`MAX_OUTPUT_TOKENS`)
  - Request timeout (`REQUEST_TIMEOUT_SECONDS`)
  - `backend/app/config.py`, `backend/app/main.py`, `backend/app/llm_service.py`
- Multi-user JWT authentication on backend routes (`/auth/register`, `/auth/login` + bearer token validation on `/api/chat` and `/api/chat/stream`)
- Refresh-session controls with token rotation/revocation (`/auth/refresh`, `/auth/logout`)
- Scope-based route authorization (`chat:write`, `chat:stream`)
  - `AUTH_USERNAME`, `AUTH_PASSWORD`, `AUTH_ROLE`, `AUTH_SCOPES`, `JWT_*`
  - `backend/app/auth.py`, `backend/app/main.py`, `.env.example`
- CORS allowlist controlled by env (`PUBLIC_URL`, optional `ALLOWED_ORIGINS`)
  - `backend/app/config.py`, `backend/app/main.py`

### 2.2 Frontend / Reverse Proxy Security

- Same-origin `/api/chat` and `/api/chat/stream` call paths from frontend
  - `frontend/src/App.jsx`
- Nginx reverse-proxy mediation between frontend and backend
  - `frontend/nginx.conf.template`
- Authorization header forwarding from frontend to backend
  - `frontend/nginx.conf.template`

### 2.3 Container Runtime Hardening

- Backend runs as non-root user
  - `backend/Dockerfile`
- Runtime restrictions for app containers:
  - `read_only: true`
  - `security_opt: no-new-privileges:true`
  - dropped Linux capabilities (minimal add-back for nginx startup behavior)
  - `tmpfs` mounts for writable runtime paths
  - `pids_limit`
  - `docker-compose.yml`
- Service health checks for backend/frontend/ollama
  - `docker-compose.yml`

### 2.4 LLM Runtime Reliability/Safety Guard

- `ollama-init` bootstrap is wired into compose lifecycle so model pull happens before backend depends on it.
- Backend startup depends on healthy `ollama` and successful `ollama-init`.
- Backend 502 now includes upstream Ollama error text to speed incident diagnosis.
- Backend uses persistent HTTP connection pooling to Ollama and passes `keep_alive` to keep model warm.
  - `docker-compose.yml`
  - `backend/app/llm_service.py`

### 2.5 Supply Chain and CI/CD Hardening

- Backend SAST and dependency audit in pipeline:
  - `bandit`, `pip-audit`
- Frontend dependency audit in pipeline:
  - `npm audit --audit-level=high`
- Dependency update automation:
  - `.github/dependabot.yml` for `pip`, `npm`, and Docker ecosystems
- Deployment health verification and failure diagnostics in Jenkins deploy stage
  - `Jenkinsfile`

## 3. Verification Evidence

Repository tests include security-focused coverage:
- `backend/tests/test_security.py`
- `backend/tests/test_auth.py`
- `backend/tests/test_api_auth.py`
- `backend/tests/test_chat_stream.py`
- `backend/tests/test_llm_service.py`
- `backend/tests/test_jwt_auth.py` (refresh replay resistance, logout revocation, scope enforcement)

Typical local verification:

```bash
pytest -q backend/tests
npm --prefix frontend run build
docker compose up -d --build
curl -fsS http://localhost:8080/healthz
```

## 4. Known Limits of Current Baseline

- Current auth store is local SQLite session state (not distributed/HA).
- TLS termination is not defined in this repository by default.
- Prompt-injection defense is rule/pattern based (not classifier-backed).
- Container hardening is applied to app services; image pinning/digests are not fully enforced yet.

## 5. Related Documents

- OWASP mapping and residual risk: `SECURITY.md`
- Future roadmap and implementation order: `docs/NEXT_STEPS.md`
