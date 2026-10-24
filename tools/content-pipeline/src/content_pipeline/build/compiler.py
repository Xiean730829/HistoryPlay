from __future__ import annotations

import json
from pathlib import Path

from yaml import YAMLError

from content_pipeline.validation.reference_validator import validate_references
from content_pipeline.validation.schema_validator import (
    Issue,
    iter_pack_files,
    load_yaml,
    validate_pack,
)


def compile_pack(pack_dir: Path) -> tuple[list[Issue], dict[str, object] | None]:
    issues = validate_pack(pack_dir)
    issues.extend(validate_references(pack_dir))
    if issues:
        return issues, None
    documents: dict[str, object] = {}
    for path, _kind in iter_pack_files(pack_dir):
        try:
            data = load_yaml(path)
        except YAMLError as error:
            return [Issue(path, f"YAML 无法解析：{error}")], None
        relative = path.relative_to(pack_dir).with_suffix(".json").as_posix()
        documents[relative] = data
    return [], documents


def write_documents(out_dir: Path, documents: dict[str, object]) -> None:
    root = out_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    for relative, data in documents.items():
        target = (root / relative).resolve()
        if not target.is_relative_to(root):
            raise ValueError(f"编译输出路径越界：{relative}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
