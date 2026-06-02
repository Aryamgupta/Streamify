#!/bin/bash
# Unified setup and deployment script for Streamify CCTV NVR on Raspberry Pi 4
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
echo " Starting Streamify CCTV NVR Pi Setup Tool        "
echo "=================================================="
echo "Workspace Dir : $WORKSPACE_DIR"
echo "Running User  : $REAL_USER"
echo "=================================================="

# 1. Install System Dependencies
echo "Step 1: Installing system dependencies (ffmpeg, nodejs, npm)..."
apt-get update
apt-get install -y ffmpeg nodejs npm

# 2. Build Backend (Run as the real user to avoid root ownership issues)
echo "Step 2: Installing backend dependencies and compiling..."
sudo -u "$REAL_USER" bash -c "cd '$BACKEND_DIR' && npm install && npm run build"

# 3. Build Frontend (Run as the real user)
echo "Step 3: Installing frontend dependencies and building dashboard assets..."
sudo -u "$REAL_USER" bash -c "cd '$FRONTEND_DIR' && npm install && npm run build"

# 4. Install systemd services
echo "Step 4: Customizing and installing systemd service descriptors..."

TEMP_BACKEND="/tmp/cctv-backend.service"
TEMP_RECORDER="/tmp/cctv-recorder.service"
TEMP_FRONTEND="/tmp/cctv-frontend.service"

# Create customized services replacing placeholders
sed -e "s|User=aryam|User=$REAL_USER|g" \
    -e "s|WorkingDirectory=/home/aryam/Documents/cctv-analysis/backend|WorkingDirectory=$BACKEND_DIR|g" \
    "$WORKSPACE_DIR/scripts/cctv-backend.service" > "$TEMP_BACKEND"

sed -e "s|User=aryam|User=$REAL_USER|g" \
    -e "s|WorkingDirectory=/home/aryam/Documents/cctv-analysis/backend|WorkingDirectory=$BACKEND_DIR|g" \
    "$WORKSPACE_DIR/scripts/cctv-recorder.service" > "$TEMP_RECORDER"

sed -e "s|User=aryam|User=$REAL_USER|g" \
    -e "s|WorkingDirectory=/home/aryam/Documents/cctv-analysis/frontend|WorkingDirectory=$FRONTEND_DIR|g" \
    "$WORKSPACE_DIR/scripts/cctv-frontend.service" > "$TEMP_FRONTEND"

# Copy to systemd
cp "$TEMP_BACKEND" /etc/systemd/system/cctv-backend.service
cp "$TEMP_RECORDER" /etc/systemd/system/cctv-recorder.service
cp "$TEMP_FRONTEND" /etc/systemd/system/cctv-frontend.service

# Cleanup
rm -f "$TEMP_BACKEND" "$TEMP_RECORDER" "$TEMP_FRONTEND"

# 5. Enable and start services
echo "Step 5: Registering services with systemd..."
systemctl daemon-reload
systemctl enable cctv-backend.service
systemctl enable cctv-recorder.service
systemctl enable cctv-frontend.service

echo "Starting services..."
systemctl start cctv-backend.service
systemctl start cctv-recorder.service
systemctl start cctv-frontend.service

echo "=================================================="
echo " Setup and Deployment Completed Successfully!     "
echo "=================================================="
echo "You can check status using:"
echo "  systemctl status cctv-backend"
echo "  systemctl status cctv-recorder"
echo "  systemctl status cctv-frontend"
echo ""
echo "Dashboard is available at: http://localhost:3000 (or http://<pi-ip>:3000)"
echo "=================================================="
