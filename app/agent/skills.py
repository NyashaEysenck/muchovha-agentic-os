"""
Agent Skills engine — discovers, activates, and manages skills
following the Agent Skills specification (https://agentskills.io).

Skills are directories containing a SKILL.md file with YAML frontmatter
(name + description) and optional scripts/, references/, assets/ dirs.
Uses progressive disclosure: only metadata is loaded at startup.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..config import config

logger = logging.getLogger(__name__)


@dataclass
class SkillMetadata:
    """Lightweight metadata parsed from SKILL.md frontmatter."""
    name: str
    description: str
    path: Path
    license: str = ""
    compatibility: str = ""
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class SkillContext:
    """Fully loaded skill — instructions + file manifest."""
    meta: SkillMetadata
    instructions: str  # Full SKILL.md body
    scripts: list[str] = field(default_factory=list)
    references: list[str] = field(default_factory=list)
    assets: list[str] = field(default_factory=list)


def _parse_frontmatter(content: str) -> tuple[dict[str, str], str]:
    """Parse YAML frontmatter from a SKILL.md file.

    Returns (frontmatter_dict, body_text).
    Simple parser — handles the flat key: value format the spec requires.
    """
    if not content.startswith("---"):
        return {}, content

    # Find closing ---
    end = content.find("---", 3)
    if end < 0:
        return {}, content

    yaml_block = content[3:end].strip()
    body = content[end + 3:].strip()

    fm: dict[str, str] = {}
    current_key = ""
    for line in yaml_block.split("\n"):
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue

        # Check for key: value
        match = re.match(r"^(\w[\w-]*)\s*:\s*(.*)", line)
        if match:
            current_key = match.group(1)
            value = match.group(2).strip().strip('"').strip("'")
            fm[current_key] = value
        elif current_key and line.startswith("  "):
            # Continuation of metadata map (nested key: value)
            nested_match = re.match(r"^\s+(\w[\w-]*)\s*:\s*(.*)", line)
            if nested_match:
                # Store as metadata.key format
                fm[f"{current_key}.{nested_match.group(1)}"] = nested_match.group(2).strip().strip('"')

    return fm, body


class SkillEngine:
    """Discovers and manages Agent Skills."""

    def __init__(self) -> None:
        self._skills: dict[str, SkillMetadata] = {}
        self._active: dict[str, SkillContext] = {}
        self._scan_roots()

    def _scan_roots(self) -> None:
        """Scan configured skill directories for SKILL.md files."""
        roots = [
            config.skills.bundled_dir,
            config.skills.system_dir,
            config.skills.user_dir,
        ]
        for root in roots:
            if os.path.isdir(root):
                self._scan_directory(Path(root))
        logger.info("Discovered %d skills", len(self._skills))

    def _scan_directory(self, root: Path) -> None:
        """Scan a single root directory for skill folders."""
        if not root.exists():
            return
        for entry in root.iterdir():
            if not entry.is_dir():
                continue
            skill_file = entry / "SKILL.md"
            if not skill_file.exists():
                continue
            try:
                content = skill_file.read_text(encoding="utf-8")
                fm, _ = _parse_frontmatter(content)
                name = fm.get("name", entry.name)
                description = fm.get("description", "")
                if not description:
                    # Extract first meaningful line as description
                    for line in content.split("\n"):
                        line = line.strip().lstrip("#").strip()
                        if line and not line.startswith("---"):
                            description = line[:200]
                            break

                meta = SkillMetadata(
                    name=name,
                    description=description,
                    path=entry,
                    license=fm.get("license", ""),
                    compatibility=fm.get("compatibility", ""),
                )

                # First discovered wins (bundled < system < user)
                if name not in self._skills:
                    self._skills[name] = meta
                    logger.debug("Found skill: %s at %s", name, entry)

            except Exception:
                logger.warning("Failed to parse skill at %s", entry, exc_info=True)

    def list_skills(self) -> list[SkillMetadata]:
        """Return metadata for all discovered skills."""
        return list(self._skills.values())

    def get_skill(self, name: str) -> SkillMetadata | None:
        return self._skills.get(name)

    def activate(self, name: str) -> SkillContext | None:
        """Fully load a skill's instructions and discover its files."""
        if name in self._active:
            return self._active[name]

        meta = self._skills.get(name)
        if not meta:
            logger.warning("Skill not found: %s", name)
            return None

        skill_file = meta.path / "SKILL.md"
        content = skill_file.read_text(encoding="utf-8")
        _, body = _parse_frontmatter(content)

        # Discover optional directories
        scripts = self._list_files(meta.path / "scripts")
        references = self._list_files(meta.path / "references")
        assets = self._list_files(meta.path / "assets")

        ctx = SkillContext(
            meta=meta,
            instructions=body,
            scripts=scripts,
            references=references,
            assets=assets,
        )
        self._active[name] = ctx
        logger.info("Activated skill: %s (%d scripts, %d refs)", name, len(scripts), len(references))
        return ctx

    def deactivate(self, name: str) -> None:
        self._active.pop(name, None)

    def is_active(self, name: str) -> bool:
        return name in self._active

    def active_skills(self) -> list[SkillContext]:
        return list(self._active.values())

    def to_prompt_xml(self) -> str:
        """Generate <available_skills> XML for injection into the agent's system prompt."""
        if not self._skills:
            return ""

        lines = ["<available_skills>"]
        for meta in self._skills.values():
            lines.append(f'  <skill name="{meta.name}">')
            lines.append(f"    <description>{meta.description}</description>")
            lines.append(f"    <location>{meta.path / 'SKILL.md'}</location>")
            lines.append("  </skill>")
        lines.append("</available_skills>")
        return "\n".join(lines)

    def active_skills_context(self) -> str:
        """Return the full instructions of all currently active skills."""
        if not self._active:
            return ""

        parts = ["<active_skills>"]
        for ctx in self._active.values():
            parts.append(f'<skill name="{ctx.meta.name}">')
            parts.append(ctx.instructions)
            parts.append("</skill>")
        parts.append("</active_skills>")
        return "\n".join(parts)

    def rescan(self) -> None:
        """Re-scan skill directories (e.g. after FSWatcher detects changes)."""
        self._skills.clear()
        self._scan_roots()

    @staticmethod
    def _list_files(directory: Path) -> list[str]:
        if not directory.exists():
            return []
        return [str(f.relative_to(directory)) for f in directory.rglob("*") if f.is_file()]
