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
- `OLLAMA_MODEL` defaults to `mistral`.

## 3. Start the Stack

```bash
docker compose up -d --build
```

Pull model once (recommended):

```bash
docker compose --profile init up ollama-init
```

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
- Strict Pydantic request validation.
- CORS restricted to configured origins.

## 5. Backend Local Test Command

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
pytest -q backend/tests
```

## 6. API Contract

- `GET /healthz`
- `POST /api/chat`

Request:

```json
{
  "prompt": "Your question",
  "max_output_tokens": 256
}
```

Response:

```json
{
  "response": "Model answer",
  "pii_redacted": true,
  "input_tokens": 42
}
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
