from __future__ import annotations

from collections.abc import Mapping

from museum.ports.content_catalog import ContentCatalog, PackReference, PublishedPack


class RuntimePackError(LookupError):
    """The approved dependency closure cannot be pinned for a new session."""


class MissingDependency(RuntimePackError):
    """A declared dependency pack version is not available as published content."""


class CyclicDependency(RuntimePackError):
    """Declared pack dependencies form a cycle."""


class ConflictingDependency(RuntimePackError):
    """The same pack id is declared at more than one exact version."""


def resolve_runtime_pack_versions(
    catalog: ContentCatalog, pack_id: str, version: str
) -> dict[str, str]:
    """Pin the root pack and its approved dependency closure at session creation."""
    pinned: dict[str, str] = {}
    visiting: list[str] = []

    def visit(current_id: str, current_version: str, *, root: bool) -> None:
        if current_id in visiting:
            cycle = visiting[visiting.index(current_id) :] + [current_id]
            raise CyclicDependency(f"内容包依赖形成循环：{' → '.join(cycle)}")
        existing = pinned.get(current_id)
        if existing is not None:
            if existing != current_version:
                raise ConflictingDependency(
                    f"同一内容包不能固定多个版本：{current_id}@{existing} 与 {current_id}@{current_version}"
                )
            return
        visiting.append(current_id)
        try:
            pack = catalog.get_published(current_id, current_version)
        except LookupError as error:
            if root:
                raise
            raise MissingDependency(
                f"依赖内容包不可用：{current_id}@{current_version}"
            ) from error
        pinned[current_id] = current_version
        for dependency in _declared_dependencies(pack):
            visit(dependency.pack_id, dependency.version, root=False)
        visiting.pop()

    visit(pack_id, version, root=True)
    return pinned


def _declared_dependencies(pack: PublishedPack) -> tuple[PackReference, ...]:
    if pack.dependencies:
        return pack.dependencies
    manifest = pack.documents.get("manifest.json")
    if not isinstance(manifest, Mapping):
        return ()
    raw = manifest.get("dependencies", [])
    if not isinstance(raw, list):
        raise MissingDependency(f"内容包依赖清单格式错误：{pack.pack_id}@{pack.version}")
    declared: list[PackReference] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, Mapping):
            raise MissingDependency(f"内容包依赖清单格式错误：{pack.pack_id}@{pack.version}")
        dep_id, dep_version = item.get("pack_id"), item.get("version")
        if not isinstance(dep_id, str) or not isinstance(dep_version, str):
            raise MissingDependency(f"内容包依赖清单格式错误：{pack.pack_id}@{pack.version}")
        if dep_id in seen:
            raise ConflictingDependency(f"同一内容包不能声明多个版本：{dep_id}")
        seen.add(dep_id)
        declared.append(PackReference(dep_id, dep_version))
    return tuple(declared)
