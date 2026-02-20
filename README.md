# Secure LLM Assistant

This project runs a local secure LLM wrapper with three services:
- `frontend` (React/Vite + Nginx)
- `backend` (FastAPI security layer)
- `ollama` (local LLM engine)

## 1. VM Prerequisites (Ubuntu)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git ufw fail2ban
sudo usermod -aG docker "$USER"
newgrp docker
```

Optional hardening:
- Disable SSH password auth and root login.
- Allow only required ports with UFW (`22`, `80`, `443` or `8080` during development).

## 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` values:
- `PUBLIC_URL` should match your frontend URL on the VM (for example `http://<floating-ip>:8080`).
- `OLLAMA_MODEL` defaults to `llama3.2:3b` (faster on CPU than larger models).
- `OLLAMA_KEEP_ALIVE` keeps model loaded between requests (default `10m`).
- `AUTH_USERNAME`/`AUTH_PASSWORD` are used by `/auth/login`.
- `AUTH_ROLE` and `AUTH_SCOPES` define route-level authorization claims in access tokens.
- `JWT_SECRET` must be set to a long random value.
- `JWT_REFRESH_TOKEN_EXPIRES_DAYS` controls refresh-session lifetime.
- `JWT_SESSION_DB_PATH` controls SQLite-backed refresh-session storage path (set to `/tmp/...` in container runtime).

## 3. Start the Stack

```bash
docker compose up -d --build
```

Model bootstrap note:
- `ollama-init` runs automatically and ensures `OLLAMA_MODEL` is present before backend startup.
- If the model already exists in the `ollama_data` volume, it exits quickly.

Then verify:

```bash
docker compose ps
curl http://localhost:8080/healthz
```

Frontend is available at `http://localhost:8080`.

## 4. Security Controls Implemented (Backend)

- Input sanitization and prompt-injection pattern checks.
- PII redaction for email, phone, SSN, and card-like numbers before LLM call.
- Sanitized logging only (no raw PII logging).
- Rate limiting (`RATE_LIMIT`) and input/output token guardrails.
- JWT access token flow with refresh rotation (`/auth/login`, `/auth/refresh`, `/auth/logout`).
- Scope enforcement on protected endpoints (`chat:write`, `chat:stream`).
- Streaming chat endpoint (`/api/chat/stream`) for faster time-to-first-token.
- Strict Pydantic request validation.
- CORS restricted to configured origins.
- Container runtime hardening for app services (`read_only`, `no-new-privileges`, capability drop, health checks).

## 5. Backend Local Test Command

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
pytest -q backend/tests
```

## 6. API Contract

- `GET /healthz`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /api/chat`
- `POST /api/chat/stream` (SSE stream)

Login request (JWT mode):

```json
{
  "username": "admin",
  "password": "change-me"
}
```

Login response:

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "token_type": "bearer",
  "expires_in": 1800,
  "refresh_expires_in": 604800,
  "role": "admin",
  "scopes": ["chat:write", "chat:stream"]
}
```

Refresh request:

```json
{
  "refresh_token": "<jwt-refresh-token>"
}
```

Logout request:

```json
{
  "refresh_token": "<jwt-refresh-token>"
}
```

Request:

```json
{
  "prompt": "Your question",
  "max_output_tokens": 128
}
```

Required request header:

```text
Authorization: Bearer <jwt-access-token>
```

Response:

```json
{
  "response": "Model answer",
  "pii_redacted": true,
  "input_tokens": 42
}
```

Streaming response format (`POST /api/chat/stream`):
- Response content type is `text/event-stream`.
- Events are emitted as `data: {...}` blocks.
- Token chunk event:

```text
data: {"delta":"Hello "}
```

- Final event:

```text
data: {"done":true,"input_tokens":42,"pii_redacted":true}
```

## 7. Auto Deploy on `master-staging` (Jenkins)

The `Jenkinsfile` now deploys automatically to your VM when branch `master-staging` is built.

One-time Jenkins setup:
- Add an `SSH Username with private key` credential with ID `csc-vm-ssh`.
- Add a `Secret text` credential with ID `csc-vm-host` containing your VM floating IP or DNS.
- Configure multibranch/webhook so pushes/merges to `master-staging` trigger a build.
- Ensure repository exists on VM at `/home/<ssh-user>/secure-programming-llm` and `.env` is already configured there.

Deploy behavior on each `master-staging` build:
- Runs tests/audits/build stages first.
- SSH to VM and fast-forward pulls `master-staging` in `/home/<ssh-user>/secure-programming-llm`.
- Executes `docker compose up -d --build --remove-orphans`.
- Verifies health via `http://localhost:8080/healthz`.

## 8. Repository Hardening

- Dependabot configuration is included in `.github/dependabot.yml` for:
  - Python dependencies (`/backend`)
  - Node dependencies (`/frontend`)
  - Dockerfiles (`/backend`, `/frontend`)
