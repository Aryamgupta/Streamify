#!/bin/bash
# Restart systemd services for Streamify CCTV NVR system
# This script must be run with sudo

set -e

# Ensure script is run with sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (using sudo):"
  echo "sudo $0"
  exit 1
fi

echo "=================================================="
echo " Restarting Streamify NVR Services                "
echo "=================================================="

# Restart services in dependency order
echo "Restarting backend..."
systemctl restart cctv-backend.service

echo "Restarting recorder..."
systemctl restart cctv-recorder.service

echo "Restarting frontend..."
systemctl restart cctv-frontend.service

echo "=================================================="
echo " Services restarted successfully!                 "
echo "=================================================="
