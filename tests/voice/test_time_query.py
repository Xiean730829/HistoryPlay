from __future__ import annotations

from museum_mcp.time_query import eras_from_pack_versions, extract_time_query


def test_year_range_and_century_are_closed_intervals() -> None:
    point = extract_time_query("带我看750年的文物")
    assert point is not None and point.kind == "range"
    assert (point.start_year, point.end_year) == (750, 750)
    chinese = extract_time_query("看看七百五十年的")
    assert chinese is not None and (chinese.start_year, chinese.end_year) == (750, 750)
    span = extract_time_query("看700到800年的文物")
    assert span is not None and (span.start_year, span.end_year) == (700, 800)
    reversed_span = extract_time_query("看800到700年的文物")
    assert reversed_span is not None and (reversed_span.start_year, reversed_span.end_year) == (700, 800)
    century = extract_time_query("看八世纪的文物")
    assert century is not None and (century.start_year, century.end_year) == (701, 800)


def test_clear_unavailable_and_protected_utterances() -> None:
    assert extract_time_query("清除时间筛选").kind == "clear"
    assert extract_time_query("看全部唐朝文物").kind == "clear"
    song = extract_time_query("看宋朝的文物")
    assert song is not None and song.kind == "unavailable"
    assert extract_time_query("进入宋代") is None
    assert extract_time_query("750年发生了什么") is None
    assert extract_time_query("不是750年") is None
    assert extract_time_query("别切到八世纪") is None
    assert extract_time_query("看开元通宝") is None
    missing = extract_time_query("看700到")
    assert missing is not None and missing.kind == "clarify"


def test_song_pack_accepts_song_years_and_does_not_treat_entry_as_time_filter() -> None:
    available = eras_from_pack_versions({"cn.song.core": "0.1.0"})
    song_year = extract_time_query(
        "看宋代1100年前后", available_eras=available, era_start=960, era_end=1279
    )
    assert song_year is not None and song_year.kind == "range"
    assert (song_year.start_year, song_year.end_year) == (1100, 1100)
    named = extract_time_query("看宋朝的文物", available_eras=available, era_start=960, era_end=1279)
    assert named is not None and named.kind == "clarify"
    tang_year = extract_time_query("看750年的文物", available_eras=available, era_start=960, era_end=1279)
    assert tang_year is not None and tang_year.kind == "unavailable"
    assert extract_time_query("进入宋代", available_eras=available) is None
