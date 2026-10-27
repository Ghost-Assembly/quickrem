#!/usr/bin/env bash
# Install native test tools on a hosted runner without hanging on a stalled mirror.
# Each download runs under a deadline and is retried; after a failure apt switches
# from the runner's Azure mirror to archive.ubuntu.com. Packages that did arrive
# stay in apt's cache, so a retry resumes. Only the final offline install runs
# dpkg, and nothing interrupts it.
set -euo pipefail

apt_dir="${1:-/etc/apt}"
attempts=3
deadline=150 # Seconds per apt command; a healthy mirror needs under ten.
apt=(apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30)
install=(install -y --no-install-recommends gjs gnome-shell libglib2.0-bin librsvg2-common
  gir1.2-soup-3.0 gir1.2-secret-1 dbus-daemon)

# coreutils timeout runs under sudo so it signals apt itself, not only sudo.
fetch() {
  sudo timeout "$deadline" "${apt[@]}" update &&
    sudo timeout "$deadline" "${apt[@]}" "${install[@]}" --download-only
}

for ((attempt = 1; ; attempt++)); do
  fetch && break
  if ((attempt == attempts)); then
    echo "::error::Native test tools did not download in $attempts attempts"
    exit 1
  fi
  echo "::warning::apt attempt $attempt failed or stalled; retrying via archive.ubuntu.com"
  mapfile -t stale < <(grep -lsF azure.archive.ubuntu.com "$apt_dir"/sources.list "$apt_dir"/sources.list.d/* || true)
  if ((${#stale[@]})); then
    sudo sed -i 's/azure[.]archive[.]ubuntu[.]com/archive.ubuntu.com/g' "${stale[@]}"
  fi
done
sudo "${apt[@]}" "${install[@]}"
