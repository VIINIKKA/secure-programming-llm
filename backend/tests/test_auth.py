from app.auth import is_api_key_valid


def test_api_key_not_required_when_expected_key_empty() -> None:
    assert is_api_key_valid(None, "")


def test_api_key_required_fails_when_missing() -> None:
    assert not is_api_key_valid(None, "top-secret")


def test_api_key_required_fails_when_invalid() -> None:
    assert not is_api_key_valid("wrong", "top-secret")


def test_api_key_required_passes_when_valid() -> None:
    assert is_api_key_valid("top-secret", "top-secret")
