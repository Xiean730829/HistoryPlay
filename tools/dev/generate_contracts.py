from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "contracts" / "schemas" / "v1"
TS_OUT = ROOT / "packages" / "contracts-ts" / "src" / "generated.ts"
PY_OUT = ROOT / "packages" / "contracts-python" / "src" / "museum_contracts" / "models.py"
HEADER = "由 tools/dev/generate_contracts.py 从 contracts/schemas/v1 生成，请勿手改。"


def load_schema(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def schema_files() -> list[Path]:
    return sorted(path for path in SCHEMAS.glob("*.schema.json") if path.name != "common.schema.json")


def pascal(name: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in re.split(r"[-_.]", name) if part)


def quote(value: object) -> str:
    return json.dumps(value)


def union(values: list, *, python: bool) -> str:
    if python:
        return f"Literal[{', '.join(quote(value) for value in values)}]"
    return " | ".join(quote(value) for value in values)


def file_title(filename: str) -> str:
    schema = load_schema(SCHEMAS / filename)
    return str(schema["title"])


class Emitter:
    def __init__(self, common: dict, python: bool) -> None:
        self.common = common
        self.python = python
        self.current: dict = common
        self.prefix = ""
        self.anon: dict[str, tuple[dict, str, dict]] = {}
        self.used_names: set[str] = set()

    def type_name(self, def_name: str) -> str:
        return pascal(self.prefix) + pascal(def_name) if self.prefix else pascal(def_name)

    def render(self, node: dict, hint: str = "Object") -> str:
        if "$ref" in node:
            return self.render_ref(node["$ref"])
        if "enum" in node:
            return union(node["enum"], python=self.python)
        if "const" in node:
            return f"Literal[{quote(node['const'])}]" if self.python else quote(node["const"])
        if "oneOf" in node:
            return " | ".join(self.render(item, hint) for item in node["oneOf"])
        kind = node.get("type")
        if isinstance(kind, list):
            return " | ".join(self.render({**node, "type": item}, hint) for item in kind)
        if kind == "string":
            return "str" if self.python else "string"
        if kind == "integer":
            return "int" if self.python else "number"
        if kind == "number":
            return "float" if self.python else "number"
        if kind == "boolean":
            return "bool" if self.python else "boolean"
        if kind == "array":
            inner = self.render(node.get("items", {}), hint)
            return f"list[{inner}]" if self.python else f"Array<{inner}>"
        if kind == "object":
            extra = node.get("additionalProperties")
            names = node.get("propertyNames")
            if extra and extra is not True and "properties" not in node:
                key = self.render(names) if isinstance(names, dict) else ("str" if self.python else "string")
                value = self.render(extra)
                return f"dict[{key}, {value}]" if self.python else f"Record<{key}, {value}>"
            if node.get("properties"):
                return self.remember(node, hint)
        return "object" if self.python else "unknown"

    def remember(self, node: dict, hint: str) -> str:
        fingerprint = json.dumps(node, sort_keys=True, ensure_ascii=True)
        for name, (existing, _prefix, _schema) in self.anon.items():
            if json.dumps(existing, sort_keys=True, ensure_ascii=True) == fingerprint:
                return name
        base = f"{pascal(self.prefix)}{pascal(hint)}"
        name = base
        index = 2
        while name in self.used_names:
            name = f"{base}{index}"
            index += 1
        self.used_names.add(name)
        self.anon[name] = (node, self.prefix, self.current)
        return name

    def render_ref(self, ref: str) -> str:
        if ref.startswith("common.schema.json#/$defs/"):
            key = ref.rsplit("/", 1)[-1]
            aliases = {
                "namespacedId": "NamespacedId",
                "nonEmptyText": "NonEmptyText",
                "opaqueId": "OpaqueId",
                "nonNegativeInt": "NonNegativeInt",
                "factGrade": "FactGrade",
                "capabilityId": "CapabilityId",
                "sessionMode": "SessionMode",
                "commandAction": "CommandAction",
                "variableValue": "VariableValue",
                "timeRange": "TimeRange",
            }
            if key in aliases:
                return aliases[key]
            return self.render(self.common["$defs"][key])
        if ref.startswith("#/$defs/"):
            key = ref.rsplit("/", 1)[-1]
            target = self.current["$defs"][key]
            if target.get("type") == "object":
                return self.type_name(key)
            return self.render(target)
        if ref.endswith(".schema.json"):
            return file_title(Path(ref).name)
        raise ValueError(f"不支持的引用：{ref}")

    def render_object(self, node: dict) -> str:
        required = set(node.get("required", []))
        lines = ["{"]
        for name, prop in node.get("properties", {}).items():
            optional = "" if name in required else "?"
            comment = f"  /** {prop['description']} */\n" if prop.get("description") else ""
            rendered = self.render(prop, name)
            lines.append(f"{comment}  {name}{optional}: {rendered};")
        lines.append("}")
        return "\n".join(lines)


def named_types(schemas: list[tuple[str, dict]]) -> list[tuple[str, dict, str]]:
    named: list[tuple[str, dict, str]] = []
    for _name, schema in schemas:
        for def_name, node in schema.get("$defs", {}).items():
            if node.get("type") == "object":
                named.append((pascal(schema["title"]) + pascal(def_name), node, schema["title"]))
        if schema.get("type") == "object" or "properties" in schema:
            named.append((pascal(schema["title"]), schema, schema["title"]))
    return named


def bind(emitter: Emitter, schemas: list[tuple[str, dict]], prefix: str) -> None:
    emitter.prefix = prefix
    emitter.current = next(schema for _name, schema in schemas if schema["title"] == prefix)


def one_of_alias(schema: dict) -> str | None:
    if "oneOf" not in schema:
        return None
    aliases = []
    for item in schema["oneOf"]:
        ref = item.get("$ref", "")
        if ref.startswith("#/$defs/"):
            aliases.append(pascal(schema["title"]) + pascal(ref.rsplit("/", 1)[-1]))
    if not aliases:
        return None
    return " | ".join(aliases)


def emit_named(emitter: Emitter, schemas: list[tuple[str, dict]], write) -> None:
    named = named_types(schemas)
    for title, _node, _prefix in named:
        emitter.used_names.add(title)
    for title, node, prefix in named:
        bind(emitter, schemas, prefix)
        write(title, node)
    emitted: set[str] = set()
    while len(emitted) < len(emitter.anon):
        for anon_name, (node, prefix, schema) in list(emitter.anon.items()):
            if anon_name in emitted:
                continue
            emitter.prefix = prefix
            emitter.current = schema
            write(anon_name, node)
            emitted.add(anon_name)


def emit_ts(common: dict, schemas: list[tuple[str, dict]]) -> str:
    emitter = Emitter(common, python=False)
    parts = [
        f"// {HEADER}",
        "export type NamespacedId = string;",
        "export type OpaqueId = string;",
        "export type NonEmptyText = string;",
        "export type NonNegativeInt = number;",
        f"export type FactGrade = {union(common['$defs']['factGrade']['enum'], python=False)};",
        f"export type CapabilityId = {union(common['$defs']['capabilityId']['enum'], python=False)};",
        f"export type SessionMode = {union(common['$defs']['sessionMode']['enum'], python=False)};",
        f"export type CommandAction = {union(common['$defs']['commandAction']['enum'], python=False)};",
        "export type VariableValue = boolean | number | string;",
        "",
        "export interface TimeRange {",
        "  start_year: number;",
        "  end_year: number;",
        f"  precision: {union(common['$defs']['timeRange']['properties']['precision']['enum'], python=False)};",
        "  calendar_note?: string;",
        "  display_label?: string;",
        "  uncertainty?: string;",
        "}",
        "",
    ]

    def write(title: str, node: dict) -> None:
        parts.append(f"export interface {title} {emitter.render_object(node)}")
        parts.append("")

    emit_named(emitter, schemas, write)
    for _name, schema in schemas:
        alias = one_of_alias(schema)
        if alias:
            parts.append(f"export type {pascal(schema['title'])} = {alias};")
            parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def typed_dict(title: str, node: dict, emitter: Emitter) -> list[str]:
    lines = [f"class {title}(TypedDict):"]
    properties = node.get("properties", {})
    if not properties:
        lines.append("    pass")
        return lines
    required = set(node.get("required", []))
    for name, prop in properties.items():
        annotation = emitter.render(prop, name)
        if name in required:
            lines.append(f"    {name}: {annotation}")
        else:
            lines.append(f"    {name}: NotRequired[{annotation}]")
    return lines


def emit_py(common: dict, schemas: list[tuple[str, dict]]) -> str:
    emitter = Emitter(common, python=True)
    parts = [
        "from __future__ import annotations",
        "",
        "from typing import Literal, NotRequired, TypedDict",
        "",
        f"# {HEADER}",
        "",
        "type NamespacedId = str",
        "type OpaqueId = str",
        "type NonEmptyText = str",
        "type NonNegativeInt = int",
        f"type FactGrade = {union(common['$defs']['factGrade']['enum'], python=True)}",
        f"type CapabilityId = {union(common['$defs']['capabilityId']['enum'], python=True)}",
        f"type SessionMode = {union(common['$defs']['sessionMode']['enum'], python=True)}",
        f"type CommandAction = {union(common['$defs']['commandAction']['enum'], python=True)}",
        "type VariableValue = bool | int | float | str",
        "",
    ]
    parts.extend(typed_dict("TimeRange", common["$defs"]["timeRange"], emitter))
    parts.append("")

    def write(title: str, node: dict) -> None:
        parts.extend(typed_dict(title, node, emitter))
        parts.append("")

    emit_named(emitter, schemas, write)
    for _name, schema in schemas:
        alias = one_of_alias(schema)
        if alias:
            parts.append(f"type {pascal(schema['title'])} = {alias}")
            parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def generate() -> tuple[str, str]:
    common = load_schema(SCHEMAS / "common.schema.json")
    schemas = [(path.stem.removesuffix(".schema"), load_schema(path)) for path in schema_files()]
    return emit_ts(common, schemas), emit_py(common, schemas)


def write_if_needed(path: Path, content: str, check: bool) -> bool:
    current = path.read_text(encoding="utf-8") if path.exists() else ""
    if current == content:
        return False
    if check:
        raise SystemExit(f"生成结果过期：{path.relative_to(ROOT)}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="从 JSON Schema 生成跨语言传输类型")
    parser.add_argument("--check", action="store_true", help="检查生成结果是否过期")
    args = parser.parse_args()
    ts, py = generate()
    changed = [
        write_if_needed(TS_OUT, ts, args.check),
        write_if_needed(PY_OUT, py, args.check),
    ]
    if args.check:
        print("生成结果与仓库一致。")
        return 0
    if any(changed):
        print(f"已写入 {TS_OUT.relative_to(ROOT)} 与 {PY_OUT.relative_to(ROOT)}")
    else:
        print("生成结果已是最新。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
