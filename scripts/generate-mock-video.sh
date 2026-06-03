#!/bin/bash
# Generate a test pattern video file for camera simulation

set -e

WORKSPACE_DIR=$(cd "$(dirname "$0")/.." && pwd)
MOCK_DIR="$WORKSPACE_DIR/mock-media"

echo "Creating mock media directory..."
mkdir -p "$MOCK_DIR"

echo "Generating mock test pattern video (10 seconds)..."
ffmpeg -y -f lavfi -i testsrc=duration=10:size=640x480:rate=10 \
  -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 -an \
  "$MOCK_DIR/test.mp4"

echo "Mock video generated at $MOCK_DIR/test.mp4"
