from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema.validators import validator_for
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "contracts" / "schemas" / "v1"
EXAMPLES = ROOT / "contracts" / "examples" / "v1"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def schema_registry() -> Registry:
    resources = []
    for path in SCHEMAS.glob("*.json"):
        contents = load_json(path)
        resources.append((contents["$id"], Resource.from_contents(contents)))
    return Registry().with_resources(resources)


def schema_path_for(example: Path) -> Path:
    path = SCHEMAS / f"{example.name.split('.', 1)[0]}.schema.json"
    if not path.exists():
        raise AssertionError(f"没有对应 Schema：{example.name}")
    return path


def validate(example: Path) -> list[str]:
    schema = load_json(schema_path_for(example))
    Validator = validator_for(schema)
    validator = Validator(schema, registry=schema_registry())
    return [error.message for error in validator.iter_errors(load_json(example))]


@pytest.mark.parametrize("example", sorted(EXAMPLES.glob("*.valid.json")))
def test_valid_examples_pass(example: Path) -> None:
    errors = validate(example)
    assert errors == [], f"{example.name}: {errors}"


@pytest.mark.parametrize("example", sorted(EXAMPLES.glob("*.invalid-*.json")))
def test_invalid_examples_fail(example: Path) -> None:
    errors = validate(example)
    assert errors, f"{example.name} 应被拒绝"
