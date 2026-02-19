import re

CONTROL_CHAR_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MULTISPACE_PATTERN = re.compile(r"[ \t]+")

PROMPT_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all|any|previous|prior)\s+instructions", re.IGNORECASE),
    re.compile(r"reveal\s+(the\s+)?system\s+prompt", re.IGNORECASE),
    re.compile(r"show\s+(the\s+)?developer\s+message", re.IGNORECASE),
    re.compile(r"bypass\s+(all\s+)?safety", re.IGNORECASE),
    re.compile(r"\bjailbreak\b", re.IGNORECASE),
]

PII_PATTERNS = {
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "phone": re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b"),
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "creditcard": re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
}

MAX_LOG_CHARS = 240


def sanitize_input(text: str) -> str:
    text = CONTROL_CHAR_PATTERN.sub(" ", text)
    text = MULTISPACE_PATTERN.sub(" ", text)
    text = text.strip()
    if not text:
        raise ValueError("Input is empty after sanitization.")
    return text


def is_prompt_injection(text: str) -> bool:
    return any(pattern.search(text) for pattern in PROMPT_INJECTION_PATTERNS)


def redact_pii(text: str) -> tuple[str, bool]:
    redacted = text
    found = False
    for label, pattern in PII_PATTERNS.items():
        placeholder = f"[REDACTED_{label.upper()}]"
        redacted, replacements = pattern.subn(placeholder, redacted)
        if replacements > 0:
            found = True
    return redacted, found


def sanitize_for_log(text: str) -> str:
    redacted, _ = redact_pii(text)
    redacted = CONTROL_CHAR_PATTERN.sub(" ", redacted).strip()
    if len(redacted) > MAX_LOG_CHARS:
        return f"{redacted[:MAX_LOG_CHARS]}...(truncated)"
    return redacted


def approx_token_count(text: str) -> int:
    if not text:
        return 0
    # Rough estimate often used for guardrails when tokenizer is unavailable.
    return max(1, len(text) // 4)
