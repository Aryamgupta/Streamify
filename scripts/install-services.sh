#!/bin/bash
# Install and register systemd services for Streamify CCTV NVR system
# This script must be run with sudo

set -e

# Ensure script is run with sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (using sudo):"
  echo "sudo $0"
  exit 1
fi

# Detect original non-root user and paths
REAL_USER=${SUDO_USER:-$(logname)}
WORKSPACE_DIR=$(cd "$(dirname "$0")/.." && pwd)
BACKEND_DIR="$WORKSPACE_DIR/backend"
FRONTEND_DIR="$WORKSPACE_DIR/frontend"

echo "=================================================="
echo " Installing Streamify NVR Systemd Services        "
echo "=================================================="
echo "Workspace Dir: $WORKSPACE_DIR"
echo "Running User : $REAL_USER"
echo "=================================================="

# Temporary path for parsed templates
TEMP_BACKEND="/tmp/cctv-backend.service"
TEMP_RECORDER="/tmp/cctv-recorder.service"
TEMP_FRONTEND="/tmp/cctv-frontend.service"

# Create customized service files from templates
echo "Customizing systemd service configs..."
sed -e "s|User=aryam|User=$REAL_USER|g" \
    -e "s|WorkingDirectory=/home/aryam/Documents/cctv-analysis/backend|WorkingDirectory=$BACKEND_DIR|g" \
    "$WORKSPACE_DIR/scripts/cctv-backend.service" > "$TEMP_BACKEND"

sed -e "s|User=aryam|User=$REAL_USER|g" \
    -e "s|WorkingDirectory=/home/aryam/Documents/cctv-analysis/backend|WorkingDirectory=$BACKEND_DIR|g" \
    "$WORKSPACE_DIR/scripts/cctv-recorder.service" > "$TEMP_RECORDER"

sed -e "s|User=aryam|User=$REAL_USER|g" \
    -e "s|WorkingDirectory=/home/aryam/Documents/cctv-analysis/frontend|WorkingDirectory=$FRONTEND_DIR|g" \
    "$WORKSPACE_DIR/scripts/cctv-frontend.service" > "$TEMP_FRONTEND"

# Copy to systemd directory
echo "Copying services to /etc/systemd/system/..."
cp "$TEMP_BACKEND" /etc/systemd/system/cctv-backend.service
cp "$TEMP_RECORDER" /etc/systemd/system/cctv-recorder.service
cp "$TEMP_FRONTEND" /etc/systemd/system/cctv-frontend.service

# Clean up temp files
rm -f "$TEMP_BACKEND" "$TEMP_RECORDER" "$TEMP_FRONTEND"

# Reload systemd configuration
echo "Reloading systemd daemon..."
systemctl daemon-reload

# Enable services to run on boot
echo "Enabling services on startup..."
systemctl enable cctv-backend.service
systemctl enable cctv-recorder.service
systemctl enable cctv-frontend.service

# Start services
echo "Starting NVR Backend, Recorder, and Frontend services..."
systemctl start cctv-backend.service
systemctl start cctv-recorder.service
systemctl start cctv-frontend.service

echo "=================================================="
echo " Installation Complete!                           "
echo "=================================================="
echo "You can check the status of the services using:"
echo "  systemctl status cctv-backend"
echo "  systemctl status cctv-recorder"
echo "  systemctl status cctv-frontend"
echo ""
echo "To view live logs from the services, run:"
echo "  journalctl -u cctv-backend -f"
echo "  journalctl -u cctv-recorder -f"
echo "  journalctl -u cctv-frontend -f"
echo "=================================================="
