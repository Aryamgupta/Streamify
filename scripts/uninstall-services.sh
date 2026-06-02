#!/bin/bash
# Stop, disable, and remove systemd services for Streamify CCTV NVR system
# This script must be run with sudo

set -e

# Ensure script is run with sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (using sudo):"
  echo "sudo $0"
  exit 1
fi

echo "=================================================="
echo " Uninstalling/Detaching Streamify NVR Services    "
echo "=================================================="

# Stop active services
echo "Stopping services..."
systemctl stop cctv-frontend.service || true
systemctl stop cctv-recorder.service || true
systemctl stop cctv-backend.service || true

# Disable startup triggers
echo "Disabling services on startup..."
systemctl disable cctv-frontend.service || true
systemctl disable cctv-recorder.service || true
systemctl disable cctv-backend.service || true

# Remove service descriptor files
echo "Removing service files from /etc/systemd/system/..."
rm -f /etc/systemd/system/cctv-backend.service
rm -f /etc/systemd/system/cctv-recorder.service
rm -f /etc/systemd/system/cctv-frontend.service

# Reload daemon registry
echo "Reloading systemd daemon..."
systemctl daemon-reload
systemctl reset-failed

echo "=================================================="
echo " Uninstallation Complete!                         "
echo " Services have been successfully stopped & detached."
echo "=================================================="
