"""Validation for the user and collection IDs that name on-disk index folders."""

import re
from pathlib import Path

ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")


def valid_id(value) -> bool:
    return isinstance(value, str) and ID_PATTERN.fullmatch(value) is not None


def collection_dir(data_dir: Path, user_id: str, collection_id: str) -> Path:
    """data_dir/user_id/collection_id, refusing anything that would land outside data_dir."""
    if not (valid_id(user_id) and valid_id(collection_id)):
        raise ValueError("invalid user or collection id")
    root = data_dir.resolve()
    path = (root / user_id / collection_id).resolve()
    if root not in path.parents:
        raise ValueError("collection path escapes the data directory")
    return path
