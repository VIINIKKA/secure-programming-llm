from app.auth import is_login_valid
from app.config import Settings


def test_login_valid_with_matching_credentials() -> None:
    settings = Settings(auth_username="alice", auth_password="strong-pass")
    assert is_login_valid("alice", "strong-pass", settings)


def test_login_invalid_with_wrong_username() -> None:
    settings = Settings(auth_username="alice", auth_password="strong-pass")
    assert not is_login_valid("bob", "strong-pass", settings)


def test_login_invalid_with_wrong_password() -> None:
    settings = Settings(auth_username="alice", auth_password="strong-pass")
    assert not is_login_valid("alice", "wrong-pass", settings)
