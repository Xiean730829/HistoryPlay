from __future__ import annotations

import os

from aiohttp import web


async def health(_: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "service": "museum-game"})


def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/health", health)
    return app


if __name__ == "__main__":
    web.run_app(
        create_app(),
        host=os.getenv("MUSEUM_HOST", "127.0.0.1"),
        port=int(os.getenv("MUSEUM_PORT", "8780")),
        print=None,
    )
