from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, ClassVar

from museum.adapters.content.spoken_name import (
    exact_spoken_names,
    generic_spoken_categories,
    normalize_spoken,
    shared_pinyin_run,
    spoken_pinyin,
)
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
    exact_names: frozenset[str]
    category: str


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
            alias_list = tuple(alias for alias in aliases if isinstance(alias, str)) if isinstance(aliases, list) else ()
            if alias_list:
                terms.extend(alias_list)
            category = raw.get("category") if isinstance(raw.get("category"), str) else ""
            documents.append(
                SearchDocument(
                    id=document_id,
                    kind=kind,
                    title=title,
                    summary=summary,
                    pack_id=pack.pack_id,
                    version=pack.version,
                    terms=tuple(_normalize(term) for term in terms if term),
                    exact_names=exact_spoken_names(title, alias_list, document_id),
                    category=_normalize(category) if category else "",
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

    def spoken_lookup(self, query: str, *, kind: str | None = "artifact") -> tuple[SearchDocument, ...]:
        """Exact first, then name fragments; never choose a best-scoring artifact.

        Two shared adjacent characters may recover a shortened/misheard name.
        All matching names are returned for clarification, not just the first.
        Facts, IDs and summaries are deliberately excluded from spoken matching.
        """
        needle = normalize_spoken(query)
        if not needle:
            return ()
        exact = tuple(
            document
            for document in self._documents
            if (kind is None or document.kind == kind) and needle in document.exact_names
        )
        if exact:
            return exact
        category = tuple(
            document
            for document in self._documents
            if (kind is None or document.kind == kind) and document.category == needle
        )
        if category:
            return category
        groups = generic_spoken_categories(query)
        grouped = tuple(
            document
            for document in self._documents
            if (kind is None or document.kind == kind) and document.category in groups
        )
        if grouped:
            return grouped
        if len(needle) < 2:
            return ()
        eligible = tuple(doc for doc in self._documents if kind is None or doc.kind == kind)
        syllables = spoken_pinyin(needle)
        if len(syllables) >= 2:
            same_sound = tuple(doc for doc in eligible if any(
                syllables == spoken_pinyin(name) for name in doc.exact_names
            ))
            if same_sound:
                return same_sound
            scored = [(doc, max((shared_pinyin_run(syllables, spoken_pinyin(name))
                                 for name in doc.exact_names), default=0)) for doc in eligible]
            best = max((score for _, score in scored), default=0)
            if best >= 2:
                return tuple(doc for doc, score in scored if score == best)
        fragments = tuple(doc for doc in eligible if any(needle in name for name in doc.exact_names))
        if fragments:
            return fragments
        pairs = {needle[index:index + 2] for index in range(len(needle) - 1)}
        return tuple(doc for doc in eligible if any(
            pair in name for pair in pairs for name in doc.exact_names
        ))

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
    return normalize_spoken(value)


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
