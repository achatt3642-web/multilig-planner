#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
workspace_dir=$(dirname -- "$project_dir")
mat_root=${MAT_PLANNER_ROOT:-$workspace_dir/Meniscus_project_noOA/MAT_planner_canonical_sync_20260405}
mat_python=${MAT_PLANNER_PYTHON:-$mat_root/.venv/bin/python}

if [ ! -x "$mat_python" ]; then
  echo "MAT Planner Python was not found at: $mat_python" >&2
  echo "Set MAT_PLANNER_ROOT or MAT_PLANNER_PYTHON to the existing MAT Planner runtime." >&2
  exit 1
fi

if [ "${1:-}" = "test" ]; then
  shift
  exec "$mat_python" -m unittest discover -s "$script_dir" -p "test_mat_nnunet_bridge.py" "$@"
fi

exec "$mat_python" "$script_dir/mat_nnunet_bridge.py" "$@"
