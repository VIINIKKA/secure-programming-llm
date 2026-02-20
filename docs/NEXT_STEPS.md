# Future Work Roadmap

This document lists the remaining hardening work after the current baseline.

For implemented controls, see:
- `docs/HARDENING_STATUS.md`
- `SECURITY.md`

## 1. Current Priority Order

Given current VM quota constraints, execute remaining work in this order:
1. Authorization and session hardening (on top of JWT)
2. TLS and ingress hardening
3. Container/image hardening completion
4. Security testing depth improvements
5. Advanced prompt-injection defense

## 2. Remaining Work Items

## 2.1 Identity and Access (Highest Priority)

Goal:
- Extend current JWT implementation to production-grade authz/session security.

Recommended target:
- Add refresh-token rotation, logout/revocation, and role/scope authorization.

Minimum acceptance criteria:
- Refresh endpoint exists with token rotation and revocation checks.
- Logout endpoint revokes active refresh token chain.
- Role/scope boundary is enforced at route level.
- Role/policy boundary is defined at least for admin vs normal user behavior.

## 2.2 TLS and Endpoint Exposure

Goal:
- Eliminate plaintext HTTP exposure for app and Jenkins in deployed environment.

Recommended target:
- Reverse proxy with TLS termination (Caddy/Nginx/Traefik).
- Restrict Jenkins endpoint to admin IP range or VPN.

Minimum acceptance criteria:
- `https://` endpoint available for app.
- Redirect HTTP to HTTPS.
- Jenkins is not publicly open to unrestricted source IPs.

## 2.3 Container and Image Hardening Completion

Goal:
- Move from baseline runtime hardening to production-grade image/runtime policy.

Minimum acceptance criteria:
- Pin critical images/tags to immutable versions/digests (avoid drifting `latest` in production paths).
- Review remaining service capabilities and remove unnecessary privileges.
- Add optional resource constraints (`mem_limit`, `cpus`) where environment allows.
- Document hardening exceptions and rationale.

## 2.4 Security Testing Expansion

Goal:
- Increase security assurance beyond unit and dependency scans.

Minimum acceptance criteria:
- Add integration tests for abuse paths:
  - invalid/missing auth
  - rate-limit behavior
  - upstream LLM failure handling
- Add a lightweight DAST stage (for example OWASP ZAP baseline) in CI.
- Add one fuzz-style test suite for input sanitizer/parser robustness.

## 2.5 Prompt-Injection Defense Upgrade

Goal:
- Improve from regex/rule-only filtering to layered detection.

Minimum acceptance criteria:
- Add a second detection layer (rule engine or classifier gate).
- Define measurable policy outcomes (block, warn, allow).
- Document false-positive/false-negative tradeoffs in report.

## 3. Recommended Implementation Plan (Practical Sequence)

1. Create feature branch for authz/session work (`work/jwt-authz`).
2. Implement refresh token + logout/revocation flow.
3. Add role/scope checks and integration tests for auth paths.
4. Create branch for TLS/reverse proxy (`work/tls-ingress`).
5. Add DAST stage after functional tests pass.
6. Finalize image pinning and hardening exception notes.

## 4. Report Delivery Checklist (Future Work Section)

When writing final course report, include:
- What is still not implemented.
- Known residual risks.
- Why items were prioritized the way they were.
- Concrete next implementation step for each unresolved risk.
