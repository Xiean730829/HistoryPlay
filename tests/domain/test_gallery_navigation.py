from __future__ import annotations

import pytest
from museum.domain.gallery.navigation import InvalidGalleryRoute, adjacent_station

STATIONS = [
    {"id": "station.one", "order": 0},
    {"id": "station.two", "order": 1},
    {"id": "station.three", "order": 2},
]


def test_adjacent_station_moves_exactly_one_in_curated_order() -> None:
    assert adjacent_station(STATIONS, "station.one", "next") == STATIONS[1]
    assert adjacent_station(STATIONS, "station.three", "previous") == STATIONS[1]


@pytest.mark.parametrize(
    ("current", "direction"),
    [("station.one", "previous"), ("station.three", "next")],
)
def test_adjacent_station_stops_at_both_boundaries(current: str, direction: str) -> None:
    assert adjacent_station(STATIONS, current, direction) is None


def test_adjacent_station_rejects_unknown_station_and_duplicate_order() -> None:
    with pytest.raises(InvalidGalleryRoute, match="不属于"):
        adjacent_station(STATIONS, "station.missing", "next")
    with pytest.raises(InvalidGalleryRoute, match="重复展位顺序"):
        adjacent_station([STATIONS[0], {"id": "station.other", "order": 0}], "station.one", "next")


def test_adjacent_station_rejects_undefined_direction() -> None:
    with pytest.raises(ValueError, match="方向"):
        adjacent_station(STATIONS, "station.one", "diagonal")  # type: ignore[arg-type]
