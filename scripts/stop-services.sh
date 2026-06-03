#!/bin/bash
# Stop systemd services for Streamify CCTV NVR system
# This script must be run with sudo

set -e

# Ensure script is run with sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (using sudo):"
  echo "sudo $0"
  exit 1
fi

echo "=================================================="
echo " Stopping Streamify NVR Services                  "
echo "=================================================="

# Stop active services
echo "Stopping services..."
systemctl stop cctv-frontend.service || true
systemctl stop cctv-recorder.service || true
systemctl stop cctv-backend.service || true

echo "=================================================="
echo " Services stopped successfully!                   "
echo "=================================================="
