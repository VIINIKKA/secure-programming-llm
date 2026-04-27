import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def isolated_auth_session_store(tmp_path, monkeypatch):
    from app import main
    from app.auth import close_auth_resources

    close_auth_resources()
    main.app.state.limiter._storage.reset()  # noqa: SLF001
    monkeypatch.setattr(main.settings, "jwt_session_db_path", str(tmp_path / "auth_sessions.db"))
    yield
    main.app.state.limiter._storage.reset()  # noqa: SLF001
    close_auth_resources()
