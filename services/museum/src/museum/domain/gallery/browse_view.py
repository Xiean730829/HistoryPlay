from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from museum.domain.gallery.navigation import InvalidGalleryRoute, _order, _station_id

Direction = Literal["next", "previous"]
PAGE_SIZES = (1, 2, 3, 4)
DEFAULT_PAGE_SIZE = 4
OPEN_ERA_START = 618
OPEN_ERA_END = 907


class InvalidGalleryView(ValueError):
    """A gallery window, page size or time filter cannot be applied."""


@dataclass(frozen=True, slots=True)
class TimeFilter:
    start_year: int
    end_year: int

    def __post_init__(self) -> None:
        start = min(self.start_year, self.end_year)
        end = max(self.start_year, self.end_year)
        object.__setattr__(self, "start_year", start)
        object.__setattr__(self, "end_year", end)


@dataclass(frozen=True, slots=True)
class GalleryView:
    window_start: int = 0
    page_size: int = DEFAULT_PAGE_SIZE
    time_filter: TimeFilter | None = None

    def __post_init__(self) -> None:
        if self.window_start < 0:
            raise InvalidGalleryView("窗口起点不能为负数")
        if self.page_size not in PAGE_SIZES:
            raise InvalidGalleryView("页容量只能是1、2、3或4")


@dataclass(frozen=True, slots=True)
class BrowseableStation:
    station_id: str
    artifact_id: str
    order: int
    start_year: int
    end_year: int
    time_unknown: bool = False


def default_gallery_view() -> GalleryView:
    return GalleryView()


def window_start_for_index(index: int, count: int, page_size: int) -> int:
    if count <= 0 or page_size <= 0:
        return 0
    clamped = max(0, min(count - 1, int(index)))
    start = (clamped // page_size) * page_size
    last_start = ((count - 1) // page_size) * page_size
    return min(start, last_start)


def parse_stations(stations: Sequence[Mapping[str, object]]) -> tuple[BrowseableStation, ...]:
    ordered = sorted(stations, key=_order)
    parsed: list[BrowseableStation] = []
    seen_ids: set[str] = set()
    seen_orders: set[int] = set()
    for station in ordered:
        station_id = _station_id(station)
        order = _order(station)
        artifact_id = station.get("artifact_id")
        time_range = station.get("time_range")
        if station_id in seen_ids:
            raise InvalidGalleryRoute("展厅包含重复展位标识")
        if order in seen_orders:
            raise InvalidGalleryRoute("展厅包含重复展位顺序")
        if not isinstance(artifact_id, str) or not artifact_id:
            raise InvalidGalleryRoute("展位缺少有效的文物标识")
        if not isinstance(time_range, Mapping):
            raise InvalidGalleryRoute(f"展位缺少年代信息：{station_id}")
        try:
            start_year = time_range["start_year"]
            end_year = time_range["end_year"]
        except KeyError as error:
            raise InvalidGalleryRoute(f"展位年代信息无效：{station_id}") from error
        if type(start_year) is not int or type(end_year) is not int:
            raise InvalidGalleryRoute(f"展位年代信息无效：{station_id}")
        precision = time_range.get("precision")
        if precision is not None and precision not in {"year", "decade", "century", "range", "unknown"}:
            raise InvalidGalleryRoute(f"展位年代信息无效：{station_id}")
        seen_ids.add(station_id)
        seen_orders.add(order)
        parsed.append(
            BrowseableStation(
                station_id=station_id,
                artifact_id=artifact_id,
                order=order,
                start_year=min(start_year, end_year),
                end_year=max(start_year, end_year),
                time_unknown=precision == "unknown",
            )
        )
    return tuple(parsed)


def filter_stations(
    stations: Sequence[BrowseableStation],
    time_filter: TimeFilter | None,
) -> tuple[BrowseableStation, ...]:
    ordered = tuple(sorted(stations, key=lambda item: item.order))
    if time_filter is None:
        return ordered
    return tuple(
        item
        for item in ordered
        if not item.time_unknown
        and item.start_year <= time_filter.end_year
        and item.end_year >= time_filter.start_year
    )


def visible_window(
    stations: Sequence[BrowseableStation],
    view: GalleryView,
) -> tuple[BrowseableStation, ...]:
    visible = filter_stations(stations, view.time_filter)
    start = window_start_for_index(view.window_start, len(visible), view.page_size)
    return visible[start : start + view.page_size]


def browse_group(
    stations: Sequence[BrowseableStation],
    current_station_id: str,
    view: GalleryView,
    direction: Direction,
) -> tuple[BrowseableStation, GalleryView] | None:
    if direction not in {"next", "previous"}:
        raise InvalidGalleryView("展廊翻组方向无效")
    visible = filter_stations(stations, view.time_filter)
    if not visible:
        return None
    start = _current_window_start(visible, current_station_id, view)
    delta = view.page_size if direction == "next" else -view.page_size
    target = start + delta
    if target < 0 or target >= len(visible):
        return None
    target_start = window_start_for_index(target, len(visible), view.page_size)
    return visible[target_start], GalleryView(
        window_start=target_start,
        page_size=view.page_size,
        time_filter=view.time_filter,
    )


def move_item(
    stations: Sequence[BrowseableStation],
    current_station_id: str,
    view: GalleryView,
    direction: Direction,
) -> tuple[BrowseableStation, GalleryView] | None:
    if direction not in {"next", "previous"}:
        raise InvalidGalleryView("展廊逐件方向无效")
    visible = filter_stations(stations, view.time_filter)
    ids = [item.station_id for item in visible]
    try:
        current_index = ids.index(current_station_id)
    except ValueError as error:
        raise InvalidGalleryRoute("当前展位不属于该展厅") from error
    target_index = current_index + (1 if direction == "next" else -1)
    if target_index < 0 or target_index >= len(visible):
        return None
    target = visible[target_index]
    return target, GalleryView(
        window_start=window_start_for_index(target_index, len(visible), view.page_size),
        page_size=view.page_size,
        time_filter=view.time_filter,
    )


def apply_time_filter(
    stations: Sequence[BrowseableStation],
    current_station_id: str | None,
    view: GalleryView,
    time_filter: TimeFilter | None,
) -> tuple[BrowseableStation | None, GalleryView]:
    visible = filter_stations(stations, time_filter)
    if not visible:
        return None, view
    ids = [item.station_id for item in visible]
    if current_station_id in ids:
        index = ids.index(current_station_id)
        anchor = visible[index]
    else:
        index = 0
        anchor = visible[0]
    return anchor, GalleryView(
        window_start=window_start_for_index(index, len(visible), view.page_size),
        page_size=view.page_size,
        time_filter=time_filter,
    )


def locate_station(
    stations: Sequence[BrowseableStation],
    artifact_id: str,
    view: GalleryView,
) -> tuple[BrowseableStation, GalleryView, bool]:
    """Return the station, the window that reveals it, and whether a filter was cleared."""
    filtered = filter_stations(stations, view.time_filter)
    match = next((item for item in filtered if item.artifact_id == artifact_id), None)
    cleared = False
    pool = filtered
    active_filter = view.time_filter
    if match is None:
        match = next((item for item in stations if item.artifact_id == artifact_id), None)
        if match is None:
            raise InvalidGalleryRoute("目标文物不在当前开放展厅")
        pool = tuple(sorted(stations, key=lambda item: item.order))
        active_filter = None
        cleared = view.time_filter is not None
    index = [item.artifact_id for item in pool].index(artifact_id)
    return (
        match,
        GalleryView(
            window_start=window_start_for_index(index, len(pool), view.page_size),
            page_size=view.page_size,
            time_filter=active_filter,
        ),
        cleared,
    )


def query_intersects_open_era(
    start_year: int,
    end_year: int,
    era_start: int = OPEN_ERA_START,
    era_end: int = OPEN_ERA_END,
) -> bool:
    start, end = min(start_year, end_year), max(start_year, end_year)
    open_start, open_end = min(era_start, era_end), max(era_start, era_end)
    return start <= open_end and end >= open_start


def _current_window_start(
    visible: Sequence[BrowseableStation],
    current_station_id: str,
    view: GalleryView,
) -> int:
    start = window_start_for_index(view.window_start, len(visible), view.page_size)
    ids = [item.station_id for item in visible]
    if current_station_id in ids:
        index = ids.index(current_station_id)
        in_window = start <= index < start + view.page_size
        if not in_window:
            return window_start_for_index(index, len(visible), view.page_size)
    return start
