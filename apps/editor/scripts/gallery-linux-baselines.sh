#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Linux screenshot baselines of the gallery of the editor.
#
# The CI job "labs-gallery" (.github/workflows/ci.yml) runs in the official Playwright image. This script runs the
# gallery tests of the editor in the same image, so the screenshots match CI. The image has the same Chromium, the same
# fonts, the same software rasterizer (SwiftShader) and the same x86-64 code (linux/amd64). On Apple silicon Docker
# runs the image through Rosetta or QEMU. The script is a copy of the script of the component gallery of CodeBlue, for
# apps/editor. It copies the working tree into the container (the files that Git tracks and the new files that Git
# does not ignore), so the node_modules folders of the host stay as they are. In the container it installs Bun and the
# locked packages, builds the tokens and the validators, and runs the gallery tests of the projects in
# GALLERY_PROJECTS. The default is "scene" (the samples from their documents). The gallery of a plugin has its own
# config in its editor face. GALLERY_APP names that folder. The WebGPU projects have no Linux baselines: the Linux
# runner has no WebGPU adapter, so CI skips that set with a notice.
#
# Usage (needs Docker; run it from any folder):
#   apps/editor/scripts/gallery-linux-baselines.sh update [playwright arguments]
#       Write the baselines of new frames and of changed frames into
#       tests/gallery/__screenshots__/<project>-linux/ of GALLERY_APP. Review the changed images before a commit.
#   apps/editor/scripts/gallery-linux-baselines.sh missing [playwright arguments]
#       Write only the baselines of new frames (--update-snapshots=missing). No existing baseline changes.
#   apps/editor/scripts/gallery-linux-baselines.sh check [playwright arguments]
#       Compare with the baselines, as CI does. The exit code is not 0 when a test fails.
#   Example: apps/editor/scripts/gallery-linux-baselines.sh update -g showroom
#   A plugin: GALLERY_APP=plugins/<name>/editor GALLERY_PROJECTS=chromium apps/editor/scripts/gallery-linux-baselines.sh check
#
# The script copies back only the baseline files that the run wrote: a new file, or a file that is not equal to the
# copy at the start of the run. It never removes a file and never replaces the folder of the host, so a baseline that
# another writer adds during the run stays. In the mode "missing" a file that is on the host at the end stays
# as it is.
#
# The results of the run (the diff images of a failed comparison) go to test-results/gallery-linux/, or to the folder
# in GALLERY_RESULTS. Playwright writes them in the container first and the script copies them at the end, because a
# Playwright run of another agent on the host can delete test-results/ during this run.
#
# The container sets CI=true and the wait factor of the CI runners (SCENITY_CI_WAIT_FACTOR, ci-timing.ts), because
# the image draws WebGL on the CPU, as the runner does. On Apple silicon the image runs under emulation, and the
# emulated CPU has no AVX2. Chromium and SwiftShader on the x86-64 runner of CI can then select other SIMD code. If CI
# finds a small difference that this script does not find, run the workflow ci by hand with the input
# "gallery_update": the artifact labs-gallery-baselines has the baselines of the CI runner.
#
# Environment:
#   GALLERY_IMAGE        the image (default: the image of the CI job; keep the two the same)
#   GALLERY_PLATFORM     the platform of the container (default linux/amd64, as the x86-64 runner)
#   BUN_VERSION          the Bun version (default 1.4.2, the packageManager of package.json)
#   GALLERY_WORKERS      the Playwright workers (default: the Playwright default)
#   GALLERY_WAIT_FACTOR  the factor of the waits (default 3, the SCENITY_CI_WAIT_FACTOR of the workflow)
#   GALLERY_RESULTS      the folder of the results (default test-results/gallery-linux of GALLERY_APP)
#   GALLERY_APP          the folder of the gallery config, from the repo root (default apps/editor)
#   GALLERY_PROJECTS     the Playwright projects, with a space between two (default "scene")
#   GALLERY_SCRIPT       the package script of GALLERY_APP that runs Playwright (default test:gallery; for example
#                        test:player of a plugin editor face)
set -euo pipefail

# The Playwright version of the image must be the version of @playwright/test in bun.lock.
DEFAULT_IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27"
IMAGE="${GALLERY_IMAGE:-$DEFAULT_IMAGE}"
PLATFORM="${GALLERY_PLATFORM:-linux/amd64}"
BUN="${BUN_VERSION:-1.4.2}"
WAIT_FACTOR="${GALLERY_WAIT_FACTOR:-3}"

mode="${1:-}"
case "$mode" in
  update) update_args=(--update-snapshots=changed) ;;
  missing) update_args=(--update-snapshots=missing) ;;
  check) update_args=(--update-snapshots=none) ;;
  *)
    echo "usage: $0 update|missing|check [playwright arguments]" >&2
    exit 2
    ;;
esac
shift

app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(git -C "$app_dir" rev-parse --show-toplevel)"
# The Git folder that all worktrees share, and the Git folder of this checkout in it: "." in the main checkout,
# worktrees/<name> in a worktree (git worktree add). The .git entry of a worktree is a file with an absolute path of
# the host, so the container gets the shared folder at /git and the two folders through GIT_DIR and GIT_COMMON_DIR.
git_common="$(cd "$repo" && cd "$(git rev-parse --git-common-dir)" && pwd)"
git_dir="$(git -C "$repo" rev-parse --absolute-git-dir)"
git_sub="${git_dir#"$git_common"}"
git_sub="${git_sub#/}"
if [ -z "$git_sub" ]; then git_sub="."; fi
gallery_app="${GALLERY_APP:-apps/editor}"
projects="${GALLERY_PROJECTS:-scene}"
gallery_script="${GALLERY_SCRIPT:-test:gallery}"
gallery_dir="$repo/$gallery_app"
shots="$gallery_dir/tests/gallery/__screenshots__"
mkdir -p "$shots" "${GALLERY_RESULTS:-$gallery_dir/test-results/gallery-linux}"
results="$(cd "${GALLERY_RESULTS:-$gallery_dir/test-results/gallery-linux}" && pwd)"

worker_args=()
if [ -n "${GALLERY_WORKERS:-}" ]; then worker_args=("--workers=$GALLERY_WORKERS"); fi
# The Playwright arguments, one per line, so that the container script gets them unchanged.
extra="$(printf '%s\n' "${update_args[@]}" ${worker_args[@]+"${worker_args[@]}"} "$@")"

docker run --rm --init \
  --platform "$PLATFORM" \
  --ipc=host \
  -v "$repo:/src:ro" \
  -v "$git_common:/git:ro" \
  -e "GIT_SUB=$git_sub" \
  -v "$shots:/shots" \
  -v "$results:/results" \
  -v scenity-gallery-bun-cache:/root/.bun/install/cache \
  -e "BUN_VERSION=$BUN" \
  -e "PW_ARGS=$extra" \
  -e "MODE=$mode" \
  -e "GALLERY_APP=$gallery_app" \
  -e "GALLERY_PROJECTS=$projects" \
  -e "GALLERY_SCRIPT=$gallery_script" \
  -e "HOST_UID=$(id -u)" \
  -e "HOST_GID=$(id -g)" \
  -e CI=true \
  -e "SCENITY_CI_WAIT_FACTOR=$WAIT_FACTOR" \
  "$IMAGE" \
  bash -euo pipefail -c '
    # Bun: the release archive of the pinned version (python3 unpacks it; the image has no unzip).
    arch="$(uname -m)"
    case "$arch" in
      # The default x64 build needs AVX2; the baseline build runs on every x86-64 CPU (and under emulation).
      x86_64) if grep -qw avx2 /proc/cpuinfo; then bun_zip="bun-linux-x64"; else bun_zip="bun-linux-x64-baseline"; fi ;;
      aarch64) bun_zip="bun-linux-aarch64" ;;
      *) echo "no Bun build for $arch" >&2; exit 1 ;;
    esac
    curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${bun_zip}.zip"
    python3 -m zipfile -e /tmp/bun.zip /tmp/bun
    install -m 0755 "/tmp/bun/${bun_zip}/bun" /usr/local/bin/bun
    ln -sf /usr/local/bin/bun /usr/local/bin/bunx
    bun --version

    # The working tree without ignored files (no node_modules, dist or test-results of the host). The Bun workspace
    # is the repo root, with the plugins and their generated contracts. Not in this repository: engine/tools/wording
    # of CodeBlue.
    git config --global --add safe.directory "*"
    mkdir -p /work
    GIT_DIR="/git/$GIT_SUB" GIT_COMMON_DIR=/git GIT_WORK_TREE=/src git -C /src ls-files -z --cached --others --exclude-standard \
      | tar -C /src --null --ignore-failed-read -T - -cf - | tar -C /work -xf -

    cd /work
    bun install --frozen-lockfile
    bun run generate

    cd "$GALLERY_APP"
    mapfile -t args <<< "$PW_ARGS"
    project_args=()
    folders=()
    for project in $GALLERY_PROJECTS; do
      project_args+=("--project=$project")
      folders+=("$project-linux")
    done
    # A copy of the baselines at the start: the copy back compares with it and takes only the files of the run.
    for folder in "${folders[@]}"; do
      mkdir -p "/tmp/before/$folder" "tests/gallery/__screenshots__/$folder"
      cp -a "tests/gallery/__screenshots__/$folder/." "/tmp/before/$folder/"
    done
    status=0
    # The default project is "scene": the samples from their documents.
    bun run "$GALLERY_SCRIPT" "${project_args[@]}" --output /tmp/results "${args[@]}" || status=$?

    if [ "$MODE" != check ]; then
      # Copy back each file that the run wrote. A temporary name and a rename make each write atomic.
      for folder in "${folders[@]}"; do
        from="tests/gallery/__screenshots__/$folder"
        written=0
        kept=0
        while IFS= read -r -d "" file; do
          rel="${file#"$from"/}"
          if [ -f "/tmp/before/$folder/$rel" ] && cmp -s "$file" "/tmp/before/$folder/$rel"; then continue; fi
          target="/shots/$folder/$rel"
          if [ "$MODE" = missing ] && [ -e "$target" ]; then
            echo "kept (on the host): $folder/$rel"
            kept=$((kept + 1))
            continue
          fi
          install -d -o "$HOST_UID" -g "$HOST_GID" "$(dirname "$target")"
          cp "$file" "$target.part"
          chown "$HOST_UID:$HOST_GID" "$target.part"
          mv -f "$target.part" "$target"
          echo "baseline: $folder/$rel"
          written=$((written + 1))
        done < <(find "$from" -type f -print0 | sort -z)
        echo "baselines: $written files written, $kept kept, in tests/gallery/__screenshots__/$folder"
      done
    fi
    if [ -d /tmp/results ]; then
      if [ -d /results ] && cp -a /tmp/results/. /results/; then
        chown -R "$HOST_UID:$HOST_GID" /results
      else
        echo "notice: the results folder of the host is gone; the results of this run are lost" >&2
      fi
    fi
    exit "$status"
  '
