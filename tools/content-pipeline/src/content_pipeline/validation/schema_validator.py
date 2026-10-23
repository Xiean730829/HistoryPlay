from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import yaml
from jsonschema.validators import validator_for
from referencing import Registry, Resource
from yaml import YAMLError

ROOT = Path(__file__).resolve().parents[5]
SCHEMAS = ROOT / "contracts" / "schemas" / "v1"
KIND_TO_SCHEMA = {
    "manifest": "content-pack.schema.json",
    "artifact": "artifact.schema.json",
    "asset": "asset.schema.json",
    "source": "source.schema.json",
    "fact": "fact-card.schema.json",
    "story": "story.schema.json",
    "story-node": "story-node.schema.json",
    "event": "historical-event.schema.json",
    "relation": "relation.schema.json",
}
PACK_LAYOUT = (
    ("manifest.yaml", "manifest", False),
    ("artifacts", "artifact", True),
    ("assets", "asset", True),
    ("sources", "source", True),
    ("facts", "fact", True),
    ("stories", "story", True),
    ("nodes", "story-node", True),
    ("events", "event", True),
    ("relations", "relation", True),
)


@dataclass(frozen=True)
class Issue:
    path: Path
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}"


def load_yaml(path: Path) -> object:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


@cache
def schema_registry() -> Registry:
    resources = []
    for path in SCHEMAS.glob("*.json"):
        contents = json.loads(path.read_text(encoding="utf-8"))
        resources.append((contents["$id"], Resource.from_contents(contents)))
    return Registry().with_resources(resources)


def validate_document(kind: str, data: object) -> list[str]:
    schema_name = KIND_TO_SCHEMA.get(kind)
    if schema_name is None:
        return [f"未知源稿类型：{kind}"]
    schema = json.loads((SCHEMAS / schema_name).read_text(encoding="utf-8"))
    Validator = validator_for(schema)
    validator = Validator(schema, registry=schema_registry())
    return [error.message for error in validator.iter_errors(data)]


def iter_pack_files(pack_dir: Path) -> list[tuple[Path, str]]:
    found: list[tuple[Path, str]] = []
    for relative, kind, many in PACK_LAYOUT:
        path = pack_dir / relative
        if many:
            if path.is_dir():
                found.extend((item, kind) for item in sorted(path.glob("*.yaml")))
            elif path.with_suffix(".yaml").is_file():
                found.append((path.with_suffix(".yaml"), kind))
        elif path.is_file():
            found.append((path, kind))
    return found


def _issues_for_document(path: Path, kind: str, data: object) -> list[Issue]:
    return [Issue(path, message) for message in validate_document(kind, data)]


def validate_pack(pack_dir: Path) -> list[Issue]:
    issues: list[Issue] = []
    manifest = pack_dir / "manifest.yaml"
    if not manifest.is_file():
        return [Issue(manifest, "缺少内容包清单")]
    files = iter_pack_files(pack_dir)
    for path, kind in files:
        try:
            data = load_yaml(path)
        except YAMLError as error:
            issues.append(Issue(path, f"YAML 无法解析：{error}"))
            continue
        if data is None:
            issues.append(Issue(path, "文件为空"))
            continue
        if kind == "relation" and isinstance(data, list):
            for index, item in enumerate(data):
                if item is None:
                    issues.append(Issue(path, f"[{index}] 条目为空"))
                    continue
                issues.extend(
                    Issue(path, f"[{index}] {message}")
                    for message in validate_document(kind, item)
                )
            continue
        issues.extend(_issues_for_document(path, kind, data))
    return issues
