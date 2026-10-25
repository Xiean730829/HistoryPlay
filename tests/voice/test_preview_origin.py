from __future__ import annotations

import pytest
from museum_voice.main import create_app


def test_current_preview_origin_is_allowed() -> None:
    create_app(None, origin="http://127.0.0.1:5190")


def test_unlisted_origin_is_still_rejected() -> None:
    with pytest.raises(ValueError, match="指定的本机游戏页面"):
        create_app(None, origin="http://127.0.0.1:5191")
