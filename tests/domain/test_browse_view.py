from __future__ import annotations

from museum.domain.gallery.browse_view import (
    GalleryView,
    TimeFilter,
    apply_time_filter,
    browse_group,
    filter_stations,
    locate_station,
    move_item,
    parse_stations,
    query_intersects_open_era,
    visible_window,
    window_start_for_index,
)

STATIONS = parse_stations(
    [
        {
            "id": "s1",
            "order": 0,
            "artifact_id": "a1",
            "time_range": {"start_year": 618, "end_year": 650},
        },
        {
            "id": "s2",
            "order": 1,
            "artifact_id": "a2",
            "time_range": {"start_year": 678, "end_year": 690},
        },
        {
            "id": "s3",
            "order": 2,
            "artifact_id": "a3",
            "time_range": {"start_year": 713, "end_year": 741},
        },
        {
            "id": "s4",
            "order": 3,
            "artifact_id": "a4",
            "time_range": {"start_year": 750, "end_year": 780},
        },
        {
            "id": "s5",
            "order": 4,
            "artifact_id": "a5",
            "time_range": {"start_year": 800, "end_year": 850},
        },
        {
            "id": "s6",
            "order": 5,
            "artifact_id": "a6",
            "time_range": {"start_year": 860, "end_year": 900},
        },
        {
            "id": "s7",
            "order": 6,
            "artifact_id": "a7",
            "time_range": {"start_year": 880, "end_year": 907},
        },
        {
            "id": "s8",
            "order": 7,
            "artifact_id": "a8",
            "time_range": {"start_year": 700, "end_year": 720},
        },
    ]
)


def test_window_start_aligns_to_page_without_padding() -> None:
    assert window_start_for_index(0, 8, 4) == 0
    assert window_start_for_index(4, 8, 4) == 4
    assert window_start_for_index(7, 8, 4) == 4
    assert window_start_for_index(18, 19, 4) == 16


def test_three_item_window_aligns_to_song_pages() -> None:
    view = GalleryView(page_size=3)
    assert [item.artifact_id for item in visible_window(STATIONS, view)] == ["a1", "a2", "a3"]
    moved = browse_group(STATIONS, "s1", view, "next")
    assert moved is not None
    target, next_view = moved
    assert target.station_id == "s4"
    assert next_view.window_start == 3


def test_move_item_slides_window_only_when_leaving_current_page() -> None:
    view = GalleryView()
    target, next_view = move_item(STATIONS, "s1", view, "next")
    assert target.station_id == "s2"
    assert next_view.window_start == 0
    last_in_window, last_view = move_item(STATIONS, "s4", view, "next")
    assert last_in_window.station_id == "s5"
    assert last_view.window_start == 4


def test_time_filter_closed_interval_zero_hits_and_century() -> None:
    view = GalleryView()
    century = TimeFilter(701, 800)
    target, next_view = apply_time_filter(STATIONS, "s1", view, century)
    assert target is not None
    assert [item.artifact_id for item in visible_window(STATIONS, next_view)] == ["a3", "a4", "a5", "a8"]
    empty, unchanged = apply_time_filter(STATIONS, "s1", view, TimeFilter(500, 517))
    assert empty is None
    assert unchanged == view
    assert query_intersects_open_era(960, 1127) is False
    assert query_intersects_open_era(800, 700) is True


def test_locate_outside_filter_clears_then_reveals_target() -> None:
    view = GalleryView(time_filter=TimeFilter(713, 741))
    station, next_view, cleared = locate_station(STATIONS, "a1", view)
    assert station.artifact_id == "a1"
    assert cleared is True
    assert next_view.time_filter is None
    assert next_view.window_start == 0


def test_eighteen_stations_page_in_threes() -> None:
    stations = parse_stations(
        [
            {
                "id": f"s{index}",
                "order": index,
                "artifact_id": f"a{index}",
                "time_range": {"start_year": 1000 + index, "end_year": 1000 + index},
            }
            for index in range(18)
        ]
    )
    view = GalleryView(page_size=3)
    assert [item.artifact_id for item in visible_window(stations, view)] == ["a0", "a1", "a2"]
    moved = browse_group(stations, "s0", view, "next")
    assert moved is not None
    assert moved[1].window_start == 3
    last = GalleryView(window_start=15, page_size=3)
    assert [item.artifact_id for item in visible_window(stations, last)] == ["a15", "a16", "a17"]
    assert browse_group(stations, "s15", last, "next") is None
    short = stations[:4]
    leftover = GalleryView(window_start=3, page_size=3)
    assert [item.artifact_id for item in visible_window(short, leftover)] == ["a3"]


def test_unknown_dates_stay_in_theme_order_but_leave_year_filters() -> None:
    stations = parse_stations(
        [
            {
                "id": "known",
                "order": 0,
                "artifact_id": "known-work",
                "time_range": {"start_year": 1080, "end_year": 1080, "precision": "year"},
            },
            {
                "id": "unknown",
                "order": 1,
                "artifact_id": "undated-poem",
                "time_range": {
                    "start_year": 960,
                    "end_year": 1279,
                    "precision": "unknown",
                    "display_label": "时间不详",
                },
            },
        ]
    )
    assert [item.artifact_id for item in filter_stations(stations, None)] == [
        "known-work",
        "undated-poem",
    ]
    filtered = filter_stations(stations, TimeFilter(1070, 1090))
    assert [item.artifact_id for item in filtered] == ["known-work"]
    station, next_view, cleared = locate_station(
        stations, "undated-poem", GalleryView(time_filter=TimeFilter(1070, 1090))
    )
    assert station.artifact_id == "undated-poem"
    assert cleared is True
    assert next_view.time_filter is None


def test_open_era_uses_the_supplied_pack_range() -> None:
    assert query_intersects_open_era(960, 1127) is False
    assert query_intersects_open_era(800, 700) is True
    assert query_intersects_open_era(1100, 1100, 960, 1279) is True
    assert query_intersects_open_era(701, 701, 960, 1279) is False
