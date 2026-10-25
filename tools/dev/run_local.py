from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MUSEUM_PORT = os.getenv("MUSEUM_PORT", "8780")
WEB_PORT = os.getenv("MUSEUM_WEB_PORT", "5173")
VOICE_PORT = os.getenv("MUSEUM_VOICE_PORT", "8782")


def wait_for_health(url: str, process: subprocess.Popen[bytes], label: str) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{label} 已退出，退出码 {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    print(f"{label} 已就绪：{url}", flush=True)
                    return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.25)
    raise TimeoutError(f"等待 {label} 健康检查超时：{url}")


def stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        process.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main() -> int:
    uv = shutil.which("uv")
    node = shutil.which("node")
    vite = ROOT / "node_modules" / "vite" / "bin" / "vite.js"
    if not uv or not node or not vite.exists():
        print("请先安装 uv、Node.js 24 和网页依赖，再运行本地服务。", file=sys.stderr)
        return 2

    processes: list[subprocess.Popen[bytes]] = []
    environment = os.environ.copy()
    binding_file = Path(
        environment.get("MUSEUM_MCP_BINDING_FILE", ".local/voice/game-binding.json")
    ).expanduser()
    if not binding_file.is_absolute():
        binding_file = ROOT / binding_file
    environment["MUSEUM_MCP_BINDING_FILE"] = str(binding_file.resolve())
    origin = f"http://127.0.0.1:{WEB_PORT}"
    configured_origins = tuple(
        item.strip()
        for item in environment.get("MUSEUM_WEB_ORIGINS", origin).split(",")
        if item.strip()
    ) or (origin,)
    environment.setdefault("MUSEUM_ALLOWED_ORIGINS", ",".join(configured_origins))
    environment.setdefault("MUSEUM_WEB_ORIGIN", configured_origins[0])
    environment.setdefault("MUSEUM_WEB_ORIGINS", ",".join(configured_origins))
    environment.setdefault("VITE_MUSEUM_GAME_URL", f"http://127.0.0.1:{MUSEUM_PORT}")
    # Keep browser voice requests on the page's own origin. Vite forwards the
    # HTTP and WebSocket routes to the private local bridge.
    environment.setdefault("VITE_MUSEUM_BRIDGE_URL", origin)
    try:
        backend = subprocess.Popen(
            [uv, "run", "--package", "museum-game", "python", "-m", "museum.main"],
            cwd=ROOT,
            env=environment,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        processes.append(backend)
        frontend = subprocess.Popen(
            [node, str(vite), "--host", "127.0.0.1", "--port", WEB_PORT, "--strictPort"],
            cwd=ROOT / "apps" / "museum-web",
            env=environment,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        processes.append(frontend)
        if environment.get("MUSEUM_XIAOZHI_DEVICE_FILE"):
            voice = subprocess.Popen(
                [uv, "run", "--package", "museum-voice-bridge", "python", "-m", "museum_voice.main"],
                cwd=ROOT,
                env=environment,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            processes.append(voice)
            wait_for_health(f"http://127.0.0.1:{VOICE_PORT}/health", voice, "语音桥")
        wait_for_health(f"http://127.0.0.1:{MUSEUM_PORT}/health", backend, "游戏服务")
        wait_for_health(f"http://127.0.0.1:{WEB_PORT}/", frontend, "网页")
        wait_for_health(
            f"http://127.0.0.1:{WEB_PORT}/api/health", frontend, "网页到游戏服务的接口"
        )
        print("按 Ctrl+C 停止全部本地服务。", flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
        return next((p.returncode or 0 for p in processes if p.poll() is not None), 0)
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError, TimeoutError) as error:
        print(f"本地启动失败：{error}", file=sys.stderr)
        return 1
    finally:
        for process in reversed(processes):
            stop(process)


if __name__ == "__main__":
    raise SystemExit(main())
