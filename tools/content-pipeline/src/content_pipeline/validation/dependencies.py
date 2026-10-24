from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from yaml import YAMLError

from content_pipeline.validation.schema_validator import Issue, load_yaml


@dataclass
class DependencyResolution:
    closure: list[Path] = field(default_factory=list)
    direct: dict[Path, list[Path]] = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)


def _manifest(pack: Path) -> tuple[dict[str, object] | None, Issue | None]:
    path = pack / "manifest.yaml"
    try:
        value = load_yaml(path)
    except (OSError, YAMLError) as error:
        return None, Issue(path, f"依赖包清单无法读取：{error}")
    if not isinstance(value, dict):
        return None, Issue(path, "依赖包清单必须是对象")
    return value, None


def resolve_dependencies(pack_dir: Path, candidates: list[Path]) -> DependencyResolution:
    """Resolve the explicitly declared dependency closure by exact package version."""
    result = DependencyResolution()
    all_paths = [pack_dir, *candidates]
    manifests: dict[Path, dict[str, object]] = {}
    by_key: dict[tuple[str, str], list[Path]] = {}
    by_id: dict[str, list[Path]] = {}
    for raw_path in all_paths:
        path = raw_path.resolve()
        manifest, issue = _manifest(path)
        if issue is not None:
            if path == pack_dir.resolve():
                result.issues.append(issue)
            continue
        assert manifest is not None
        manifests[path] = manifest
        pack_id, version = manifest.get("id"), manifest.get("version")
        if isinstance(pack_id, str) and isinstance(version, str):
            by_key.setdefault((pack_id, version), []).append(path)
            by_id.setdefault(pack_id, []).append(path)

    for key, paths in by_key.items():
        if len(paths) > 1:
            result.issues.append(
                Issue(pack_dir / "manifest.yaml", f"依赖候选包重复：{key[0]}@{key[1]}")
            )

    visited: set[Path] = set()
    active: list[Path] = []

    def visit(path: Path) -> None:
        if path in active:
            cycle = active[active.index(path) :] + [path]
            ids = [str(manifests[p].get("id", p.name)) for p in cycle]
            result.issues.append(
                Issue(active[-1] / "manifest.yaml", f"内容包依赖形成循环：{' → '.join(ids)}")
            )
            return
        if path in visited:
            return
        active.append(path)
        manifest = manifests[path]
        raw_dependencies = manifest.get("dependencies", [])
        dependencies = raw_dependencies if isinstance(raw_dependencies, list) else []
        direct: list[Path] = []
        seen_ids: set[str] = set()
        for item in dependencies:
            if not isinstance(item, dict):
                continue  # The document schema reports malformed entries.
            dep_id, version = item.get("pack_id"), item.get("version")
            if not isinstance(dep_id, str) or not isinstance(version, str):
                continue
            manifest_path = path / "manifest.yaml"
            if dep_id in seen_ids:
                result.issues.append(Issue(manifest_path, f"同一内容包不能声明多个版本：{dep_id}"))
                continue
            seen_ids.add(dep_id)
            matches = by_key.get((dep_id, version), [])
            if not matches:
                other_versions = sorted(
                    str(candidate.get("version"))
                    for candidate_path in by_id.get(dep_id, [])
                    if (candidate := manifests[candidate_path]).get("version") != version
                )
                detail = f"可用版本：{', '.join(other_versions)}" if other_versions else "未提供该内容包"
                result.issues.append(Issue(manifest_path, f"依赖缺少精确版本 {dep_id}@{version}（{detail}）"))
                continue
            dependency = matches[0]
            if dependency in active:
                cycle = active[active.index(dependency) :] + [dependency]
                ids = [str(manifests[p].get("id", p.name)) for p in cycle]
                result.issues.append(Issue(manifest_path, f"内容包依赖形成循环：{' → '.join(ids)}"))
                continue
            direct.append(dependency)
            visit(dependency)
        result.direct[path] = direct
        active.pop()
        visited.add(path)
        if path != pack_dir.resolve():
            result.closure.append(path)

    root = pack_dir.resolve()
    if root in manifests:
        visit(root)
    return result


def dependency_hash(pack_dir: Path) -> str:
    """Hash normalized source documents, independent of YAML formatting and file order."""
    from content_pipeline.validation.schema_validator import iter_pack_files

    documents: dict[str, object] = {}
    for path, _kind in iter_pack_files(pack_dir):
        documents[path.relative_to(pack_dir).as_posix()] = load_yaml(path)
    payload = json.dumps(documents, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
