# Project Overview: Secure LLM Wrapper/Assistant
**Target Environment:** CSC Cloud OpenStack VM
**Hardware Specs:** 8 vCPUs, 31.2GB RAM, 80GB Disk (CPU-only inference).
**Primary Focus:** Secure Software Development Lifecycle (DevSecOps), OWASP Top 10 for LLMs (2025), and GDPR/CRA compliance.

## 1. System Architecture
The application consists of three containerized services managed via Docker Compose:
1.  **Frontend (React/Vite):** A simple, clean chat interface.
2.  **Backend (FastAPI - Python):** Acts as a secure proxy and sanitizer between the user and the LLM. 
3.  **LLM Engine (Ollama):** Hosted locally within the Docker network, running a 4-bit quantized model (e.g., `mistral` or `llama3`) for efficient CPU inference.

### Traffic Flow:
`User` -> `Frontend` -> `FastAPI Backend (Security Layer)` -> `Ollama Engine`

## 2. Security Requirements (Strict Enforcement)
The agent must implement the following security features based on the **OWASP Top 10 for LLM Applications (2025)** and course materials:

* **LLM01:2025 Prompt Injection:** * Backend must implement input sanitization. Use a dedicated library or robust regex to strip control characters and system-level prompt-leakage attempts.
    * System prompts must explicitly constrain the LLM's behavior.
* **LLM02:2025 Sensitive Information Disclosure & GDPR:**
    * Implement PII (Personally Identifiable Information) redaction. The backend must scrub sensitive data (emails, SSNs, phone numbers) *before* sending the prompt to Ollama using a library like `presidio-analyzer`.
    * Logs must be completely sanitized (No PII stored in backend logs).
* **LLM10:2025 Unbounded Consumption:**
    * The FastAPI backend must implement **Rate Limiting** to prevent Denial of Wallet/Service attacks.
    * Set strict max-token limits on user inputs and LLM outputs.
* **Secure Implementation Basics:**
    * Do not hardcode any credentials or tokens. Use `.env` files.
    * Backend APIs must validate all input data types using Pydantic.
    * CORS policies must be strictly bound to the frontend's address.

## 3. Directory Structure
```text
secure-llm-assistant/
│
├── frontend/                 # React application
│   ├── src/
│   ├── package.json
│   └── Dockerfile
│
├── backend/                  # FastAPI application
│   ├── app/
│   │   ├── main.py           # API routes & Rate Limiting
│   │   ├── security.py       # PII scrubbing & Input sanitization
│   │   └── llm_service.py    # Wrapper to communicate with Ollama container
│   ├── requirements.txt
│   └── Dockerfile
│
├── .env.example              # Template for environment variables
├── docker-compose.yml        # Orchestrates Frontend, Backend, and Ollama
└── Jenkinsfile               # DevSecOps Pipeline configuration
