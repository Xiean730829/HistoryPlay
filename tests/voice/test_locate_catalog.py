from museum.adapters.content.search_index import PublishedSearchIndex
from museum.ports.content_catalog import PublishedPack
from museum_mcp.intent_adapter import interpret


def _artifact(ident: str, title: str, aliases: list[str]) -> dict:
    return {
        "id": ident,
        "title": title,
        "aliases": aliases,
        "museum": {"name": "Test", "accession": "T"},
        "time_range": {"start_year": 618, "end_year": 907, "precision": "range"},
        "material": "陶",
        "category": "展品",
        "asset_ids": [],
        "fact_card_ids": [],
        "story_entry_ids": [],
    }


CATALOG = PublishedSearchIndex(
    PublishedPack(
        "cn.tang.core",
        "0.3.0",
        "1",
        {
            "manifest.json": {"id": "cn.tang.core", "version": "0.3.0"},
            "artifacts/stele.json": _artifact(
                "cn.tang.artifact.votive-stele",
                "佛与二菩萨造像碑",
                ["一佛二菩萨造像碑", "造像碑"],
            ),
            "artifacts/coin.json": _artifact(
                "cn.tang.artifact.kaiyuan-coin",
                "开元通宝",
                ["铜钱", "钱币", "开元通宝铜钱"],
            ),
            "artifacts/bull.json": _artifact(
                "cn.tang.artifact.gilt-bronze-bull",
                "鎏金卧牛",
                ["卧牛", "那头牛"],
            ),
            "artifacts/lute.json": {
                **_artifact(
                    "cn.tang.artifact.lute-musician",
                    "弹拨乐俑",
                    ["弹拨乐器俑", "弹拨乐器乐俑"],
                ),
                "category": "乐俑",
            },
            "artifacts/flute.json": {
                **_artifact(
                    "cn.tang.artifact.flute-musician",
                    "吹笛乐俑",
                    ["吹竹笛乐俑", "吹笛子的乐俑", "吹笛子的"],
                ),
                "category": "乐俑",
            },
            "artifacts/follower.json": _artifact(
                "cn.tang.artifact.buddha-follower",
                "佛陀抚顶浮雕",
                ["抚顶浮雕", "佛陀抚触随从头部浮雕"],
            ),
            "artifacts/seated.json": _artifact(
                "cn.tang.artifact.seated-buddha-tianlongshan",
                "天龙山坐佛",
                ["天龙山石窟坐佛"],
            ),
            "artifacts/dvarapala.json": _artifact(
                "cn.tang.artifact.dvarapala",
                "寺院守门力士",
                ["守门力士", "寺院力士"],
            ),
            "artifacts/head.json": _artifact(
                "cn.tang.artifact.guardian-head",
                "天龙山力士头像",
                ["力士头像"],
            ),
            "artifacts/mirror.json": _artifact(
                "cn.tang.artifact.bronze-mirror",
                "铜镜",
                ["镜子", "唐代铜镜"],
            ),
            "artifacts/guardian.json": _artifact(
                "cn.tang.artifact.tomb-guardian",
                "镇墓兽",
                ["墓葬镇墓兽"],
            ),
            "artifacts/mia-woman.json": {
                **_artifact(
                    "cn.tang.artifact.woman-figure-mia",
                    "Mia女俑",
                    ["明尼阿波利斯女俑", "MIA女俑"],
                ),
                "category": "女俑",
            },
            "artifacts/mhc-woman.json": {
                **_artifact(
                    "cn.tang.artifact.standing-woman-mhc",
                    "女立俑",
                    ["立姿女俑"],
                ),
                "category": "女俑",
            },
        },
    )
)


def _artifact_ids(query: str) -> list[str]:
    return [item.id for item in CATALOG.search(query, kind="artifact")]


def _spoken_ids(query: str) -> list[str]:
    return [item.id for item in CATALOG.spoken_lookup(query, kind="artifact")]


def test_two_character_fragments_and_asr_typos_are_deterministic_not_best_guess():
    assert _spoken_ids("守门") == ["cn.tang.artifact.dvarapala"]
    assert _spoken_ids("寺院守门") == ["cn.tang.artifact.dvarapala"]
    assert _spoken_ids("寺园守门") == ["cn.tang.artifact.dvarapala"]
    assert _spoken_ids("铜钳") == ["cn.tang.artifact.kaiyuan-coin"]
    assert _spoken_ids("开园通宝") == ["cn.tang.artifact.kaiyuan-coin"]
    assert _spoken_ids("佛象") == ["cn.tang.artifact.votive-stele"]
    assert _spoken_ids("吹滴乐俑") == ["cn.tang.artifact.flute-musician"]
    assert len(_spoken_ids("乐佣")) == 2
    assert _spoken_ids("铜") == []
    assert _spoken_ids("不存在的物件") == []


def test_pinyin_recovers_homophones_without_guessing_between_shared_names():
    assert _spoken_ids("天龙山作佛") == ["cn.tang.artifact.seated-buddha-tianlongshan"]
    assert _spoken_ids("天荣山座佛") == ["cn.tang.artifact.seated-buddha-tianlongshan"]
    assert set(_spoken_ids("天龙山")) == {
        "cn.tang.artifact.seated-buddha-tianlongshan", "cn.tang.artifact.guardian-head",
    }


def test_full_names_resolve_to_one_catalog_id():
    cases = {
        "看佛像": "cn.tang.artifact.votive-stele",
        "看天龙山坐佛": "cn.tang.artifact.seated-buddha-tianlongshan",
        "看佛陀抚顶浮雕": "cn.tang.artifact.buddha-follower",
        "看天龙山力士头像": "cn.tang.artifact.guardian-head",
        "看铜镜": "cn.tang.artifact.bronze-mirror",
        "看铜钱": "cn.tang.artifact.kaiyuan-coin",
        "不看铜钱，带我看镇墓兽": "cn.tang.artifact.tomb-guardian",
        "看弹拨乐俑": "cn.tang.artifact.lute-musician",
        "看吹笛乐俑": "cn.tang.artifact.flute-musician",
        "看吹笛子的": "cn.tang.artifact.flute-musician",
        "看守门力士": "cn.tang.artifact.dvarapala",
        "看寺院力士": "cn.tang.artifact.dvarapala",
        "不看铜钱，带我看吹笛乐俑": "cn.tang.artifact.flute-musician",
        "看铜镜了": "cn.tang.artifact.bronze-mirror",
        "我想看天龙山坐佛了": "cn.tang.artifact.seated-buddha-tianlongshan",
        "再看铜钱": "cn.tang.artifact.kaiyuan-coin",
        "再看看铜钱": "cn.tang.artifact.kaiyuan-coin",
        "再看看弹拨乐俑": "cn.tang.artifact.lute-musician",
        "再看看铜镜": "cn.tang.artifact.bronze-mirror",
        "给我看看镇墓兽": "cn.tang.artifact.tomb-guardian",
        "不要看铜钱了，带我看镇墓兽": "cn.tang.artifact.tomb-guardian",
        "不要看铜钱了去看牛": "cn.tang.artifact.gilt-bronze-bull",
    }
    for utterance, expected in cases.items():
        intent = interpret(utterance)
        assert intent is not None and intent.kind == "locate" and intent.query
        found = _artifact_ids(intent.query)
        assert found == [expected], (utterance, intent.query, found)


def test_generic_woman_figure_stays_ambiguous_until_full_name():
    intent = interpret("看女俑")
    assert intent is not None and intent.query == "女俑"
    found = _artifact_ids(intent.query)
    assert set(found) == {
        "cn.tang.artifact.woman-figure-mia",
        "cn.tang.artifact.standing-woman-mhc",
    }
    full = interpret("看明尼阿波利斯女俑")
    assert full is not None and full.query
    assert _artifact_ids(full.query) == ["cn.tang.artifact.woman-figure-mia"]


def test_spoken_lookup_uses_exact_title_alias_and_compat_names():
    cases = {
        "牛": "cn.tang.artifact.gilt-bronze-bull",
        "金牛": "cn.tang.artifact.gilt-bronze-bull",
        "流金牛": "cn.tang.artifact.gilt-bronze-bull",
        "铜钱": "cn.tang.artifact.kaiyuan-coin",
        "钱币": "cn.tang.artifact.kaiyuan-coin",
        "佛像": "cn.tang.artifact.votive-stele",
        "原来的佛像": "cn.tang.artifact.votive-stele",
        "造像碑": "cn.tang.artifact.votive-stele",
        "抚顶浮雕": "cn.tang.artifact.buddha-follower",
        "弹拨乐俑": "cn.tang.artifact.lute-musician",
        "吹笛乐俑": "cn.tang.artifact.flute-musician",
        "守门力士": "cn.tang.artifact.dvarapala",
    }
    for query, expected in cases.items():
        found = _spoken_ids(query)
        assert found == [expected], (query, found)
    assert set(_spoken_ids("女俑")) == {
        "cn.tang.artifact.woman-figure-mia",
        "cn.tang.artifact.standing-woman-mhc",
    }
    assert set(_spoken_ids("乐俑")) == {
        "cn.tang.artifact.lute-musician",
        "cn.tang.artifact.flute-musician",
    }
    assert set(_spoken_ids("人俑")) == {
        "cn.tang.artifact.lute-musician",
        "cn.tang.artifact.flute-musician",
        "cn.tang.artifact.woman-figure-mia",
        "cn.tang.artifact.standing-woman-mhc",
    }
    assert _spoken_ids("不存在的王冠") == []
    assert _spoken_ids("净水瓶") == []


def test_unknown_name_does_not_fabricate_an_id():
    intent = interpret("看不存在的文物")
    assert intent is not None and intent.query == "不存在的文物"
    assert intent.query.startswith("不存在")
    assert _artifact_ids(intent.query) == []


SONG_CATALOG = PublishedSearchIndex(
    PublishedPack(
        "cn.song.core",
        "0.1.0",
        "1",
        {
            "manifest.json": {"id": "cn.song.core", "version": "0.1.0"},
            "artifacts/ewer.json": {
                **_artifact(
                    "cn.song.artifact.qingbai-ewer",
                    "青白瓷注子",
                    ["青白瓷注子", "注子", "青白瓷壶", "18.57.1"],
                ),
                "category": "注子",
                "time_range": {"start_year": 1000, "end_year": 1099, "precision": "century"},
            },
            "artifacts/celadon.json": {
                **_artifact("cn.song.artifact.celadon-vase", "官窑青瓷直颈瓶", ["青瓷瓶"]),
                "category": "青瓷",
            },
            "artifacts/longquan.json": {
                **_artifact("cn.song.artifact.longquan-vase", "龙泉窑青瓷瓶", ["龙泉瓶"]),
                "category": "青瓷",
            },
            "artifacts/tea.json": {
                **_artifact("cn.song.artifact.tea-bowl", "兔毫茶盏", ["兔毫盏"]),
                "category": "茶盏",
            },
            "artifacts/tea-2.json": {
                **_artifact("cn.song.artifact.jian-bowl", "建窑茶盏", ["建盏"]),
                "category": "茶盏",
            },
        },
    )
)


def _song_spoken(query: str) -> list[str]:
    return [item.id for item in SONG_CATALOG.spoken_lookup(query, kind="artifact")]


def test_song_aliases_are_unique_and_never_jump_to_the_gilt_bull():
    assert _song_spoken("青白瓷注子") == ["cn.song.artifact.qingbai-ewer"]
    assert _song_spoken("注子") == ["cn.song.artifact.qingbai-ewer"]
    assert _song_spoken("18.57.1") == ["cn.song.artifact.qingbai-ewer"]
    assert _song_spoken("鎏金牛") == []
    assert _song_spoken("牛") == []
    assert set(_song_spoken("青瓷")) == {
        "cn.song.artifact.celadon-vase",
        "cn.song.artifact.longquan-vase",
    }
    assert set(_song_spoken("茶盏")) == {
        "cn.song.artifact.tea-bowl",
        "cn.song.artifact.jian-bowl",
    }
    intent = interpret("看青白瓷注子")
    assert intent is not None and intent.kind == "locate" and intent.query == "青白瓷注子"
    assert _song_spoken(intent.query) == ["cn.song.artifact.qingbai-ewer"]
