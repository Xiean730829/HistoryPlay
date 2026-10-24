from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal

Direction = Literal["next", "previous"]


class InvalidGalleryRoute(ValueError):
    """A published gallery route is malformed or does not contain the current station."""


def adjacent_station(
    stations: Sequence[Mapping[str, object]],
    current_station_id: str,
    direction: Direction,
) -> Mapping[str, object] | None:
    """Return the immediately adjacent station, or ``None`` at either route boundary."""
    if direction not in {"next", "previous"}:
        raise ValueError("展位移动方向无效")

    ordered = sorted(stations, key=_order)
    station_ids = [_station_id(station) for station in ordered]
    if len(station_ids) != len(set(station_ids)):
        raise InvalidGalleryRoute("展厅包含重复展位标识")
    orders = [_order(station) for station in ordered]
    if len(orders) != len(set(orders)):
        raise InvalidGalleryRoute("展厅包含重复展位顺序")
    try:
        current_index = station_ids.index(current_station_id)
    except ValueError as error:
        raise InvalidGalleryRoute("当前展位不属于该展厅") from error

    target_index = current_index + (1 if direction == "next" else -1)
    if target_index < 0 or target_index >= len(ordered):
        return None
    return ordered[target_index]


def _order(station: Mapping[str, object]) -> int:
    order = station.get("order")
    if type(order) is not int or order < 0:
        raise InvalidGalleryRoute("展位顺序无效")
    return order


def _station_id(station: Mapping[str, object]) -> str:
    station_id = station.get("id")
    if not isinstance(station_id, str) or not station_id:
        raise InvalidGalleryRoute("展位标识无效")
    return station_id
