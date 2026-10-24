"""Non-sensitive diagnostic tools; never binds or moves the game."""

from mcp.server.fastmcp import FastMCP

SENTENCE = "这里是时空博物馆。我们正通过一件文物，走近唐朝人的生活。"


def create_probe() -> FastMCP:
    server = FastMCP("时空博物馆接入诊断")

    @server.tool()
    def museum_probe() -> dict:
        """用户要求测试时空博物馆连接时调用；只诊断，不控制游戏。"""
        return {
            "status": "diagnostic_tool_called",
            "message": "时空博物馆诊断工具已调用",
            "limitation": "工具调用成功不代表语音、指定稿逐字朗读或游戏控制已通过",
        }

    @server.tool()
    def museum_probe_sentence() -> dict:
        """取博物馆测试句；用户要求逐字朗读测试时使用。不自行标记音频播放成功。"""
        return {
            "prepared_sentence": SENTENCE,
            "instruction": "请逐字朗读prepared_sentence，不添加开场白；实际声音由用户核对",
            "tts_verified": False,
            "turn_association_verified": False,
        }

    return server


def main() -> None:
    create_probe().run(transport="stdio")


if __name__ == "__main__":
    main()
