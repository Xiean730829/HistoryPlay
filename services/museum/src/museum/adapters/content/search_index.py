from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, ClassVar

from museum.ports.content_catalog import PublishedPack


@dataclass(frozen=True, slots=True)
class SearchDocument:
    id: str
    kind: str
    title: str
    summary: str
    pack_id: str
    version: str
    terms: tuple[str, ...]


class PublishedSearchIndex:
    """A small deterministic substring index over one immutable published pack."""

    _DIRECTORIES: ClassVar[dict[str, str]] = {
        "artifacts/": "artifact",
        "events/": "event",
        "facts/": "fact",
        "nodes/": "node",
        "sources/": "source",
        "stories/": "story",
    }

    def __init__(self, pack: PublishedPack) -> None:
        documents: list[SearchDocument] = []
        self._raw_documents = tuple(pack.documents.items())
        for path, raw in pack.documents.items():
            kind = next(
                (value for prefix, value in self._DIRECTORIES.items() if path.startswith(prefix)),
                None,
            )
            if kind is None or not isinstance(raw, Mapping):
                continue
            document_id = raw.get("id")
            title = raw.get("title", raw.get("claim", raw.get("narration")))
            if not isinstance(document_id, str) or not isinstance(title, str):
                continue
            summary = _summary(kind, raw)
            terms = [title, document_id, summary]
            aliases = raw.get("aliases", ())
            if isinstance(aliases, list):
                terms.extend(alias for alias in aliases if isinstance(alias, str))
            documents.append(
                SearchDocument(
                    id=document_id,
                    kind=kind,
                    title=title,
                    summary=summary,
                    pack_id=pack.pack_id,
                    version=pack.version,
                    terms=tuple(_normalize(term) for term in terms if term),
                )
            )
        self._documents = tuple(sorted(documents, key=lambda item: (item.title, item.id)))

    def search(self, query: str, *, kind: str | None = None) -> tuple[SearchDocument, ...]:
        needle = _normalize(query)
        if not needle:
            return ()
        return tuple(
            document
            for document in self._documents
            if (kind is None or document.kind == kind)
            and any(needle in term for term in document.terms)
        )

    def get(self, document_id: str, *, kind: str) -> Mapping[str, Any] | None:
        prefix = next((path for path, value in self._DIRECTORIES.items() if value == kind), None)
        if prefix is None:
            return None
        for path, document in self._raw_documents:
            if (
                path.startswith(prefix)
                and isinstance(document, Mapping)
                and document.get("id") == document_id
            ):
                return document
        return None

def _normalize(value: str) -> str:
    return "".join(value.casefold().split())


def _summary(kind: str, document: Mapping[str, Any]) -> str:
    if kind == "artifact":
        return " · ".join(
            value
            for value in (document.get("material"), document.get("category"))
            if isinstance(value, str)
        )
    if kind == "fact":
        return str(document.get("claim", ""))
    if kind == "event":
        place = document.get("place")
        return place.get("label", "") if isinstance(place, Mapping) else ""
    if kind == "story":
        return str(document.get("title", ""))
    return ""
