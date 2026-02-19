from app.config import Settings


def test_cors_origin_defaults_to_public_url() -> None:
    settings = Settings(public_url="http://203.0.113.10:8080", allowed_origins="")
    assert settings.cors_origins == ["http://203.0.113.10:8080"]


def test_cors_origin_uses_explicit_list() -> None:
    settings = Settings(
        public_url="http://203.0.113.10:8080",
        allowed_origins="http://203.0.113.10:8080,http://localhost:8080",
    )
    assert settings.cors_origins == ["http://203.0.113.10:8080", "http://localhost:8080"]
