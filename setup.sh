#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

resolve_script_path() {
  local path="$1"

  if command -v realpath >/dev/null 2>&1; then
    realpath "$path" 2>/dev/null && return
  fi

  if command -v readlink >/dev/null 2>&1; then
    readlink -f "$path" 2>/dev/null && return
  fi

  local dir
  dir="$(cd -P "$(dirname "$path")" && pwd)"
  printf '%s/%s\n' "$dir" "$(basename "$path")"
}

SCRIPT_PATH="$(resolve_script_path "${BASH_SOURCE[0]}")"
MODULE_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd -P)"
ROOT_DIR="$(cd "$MODULE_DIR/.." && pwd -P)"
DEST="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

source "$ROOT_DIR/setup/lib.sh"

# Herdr owns most of ~/.config/herdr-app (shipped mods and layouts, AGENTS.md,
# *.d.ts, state), so the folder itself is never linked: only what's ours, one
# link per item. Every folder in mods/ and every file in layouts/ and themes/
# is picked up, so a new mod needs no change here.
# With names (mods or paths such as layouts/cjvnjde.json), only those.
managed_items() {
  local path
  if [ "$#" -gt 0 ]; then
    for path in "$@"; do
      if [ -e "$MODULE_DIR/$path" ]; then printf '%s\n' "$path"
      elif [ -d "$MODULE_DIR/mods/$path" ]; then printf 'mods/%s\n' "$path"
      else warn "Not in this module: $path"
      fi
    done
    return 0
  fi
  shopt -s nullglob
  for path in "$MODULE_DIR"/mods/*/; do
    printf 'mods/%s\n' "$(basename "$path")"
  done
  for path in "$MODULE_DIR"/layouts/*.json "$MODULE_DIR"/layouts/*.svg "$MODULE_DIR"/layouts/*.png "$MODULE_DIR"/themes/*.json; do
    printf '%s/%s\n' "$(basename "$(dirname "$path")")" "$(basename "$path")"
  done
  for path in settings.json keys.json programs.json; do
    [ -e "$MODULE_DIR/$path" ] && printf '%s\n' "$path"
  done
  shopt -u nullglob
}

enable() {
  local item
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    link_path "$MODULE_DIR/$item" "$DEST/$item"
  done <<< "$(managed_items)"
}

# Herdr's file watcher doesn't see edits behind a symlink, but it does see a
# link being replaced: re-creating the links makes it reload them.
reload() {
  local item
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    if is_link_to "$MODULE_DIR/$item" "$DEST/$item"; then
      rm -f "$DEST/$item"
      ln -s "$MODULE_DIR/$item" "$DEST/$item"
      success "Reloaded → $DEST/$item"
    else
      link_path "$MODULE_DIR/$item" "$DEST/$item"
    fi
  done <<< "$(managed_items "$@")"
}

disable() {
  local item
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    unlink_path "$MODULE_DIR/$item" "$DEST/$item"
  done <<< "$(managed_items)"
}

case "${1:-}" in
  enable)
    enable
    ;;
  disable)
    disable
    ;;
  reload)
    shift
    reload "$@"
    ;;
  *)
    error "Usage: bash $MODULE_DIR/setup.sh <enable|disable|reload [mod|path ...]>"
    exit 1
    ;;
esac
