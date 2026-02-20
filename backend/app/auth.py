import secrets


def is_api_key_valid(provided_key: str | None, expected_key: str) -> bool:
    if not expected_key:
        return True
    if not provided_key:
        return False
    return secrets.compare_digest(provided_key, expected_key)
