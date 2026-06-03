import os
import sys
import time
import json
import sqlite3
import threading
import requests
import numpy as np
import cv2
import face_recognition
from datetime import datetime

# Configuration variables from environment
DB_PATH = os.getenv("DB_PATH", "/app/data/cctv.db")
SNAPSHOTS_PATH = os.getenv("SNAPSHOTS_PATH", "/app/recordings/snapshots")
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:5000")
API_KEY = os.getenv("AI_API_KEY", "streamify-ai-secret-key-change-this")
DETECT_INTERVAL = float(os.getenv("DETECT_INTERVAL", "1.0"))
FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.6"))

# Ensure paths exist
os.makedirs(SNAPSHOTS_PATH, exist_ok=True)
MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
os.makedirs(MODELS_DIR, exist_ok=True)

# MobileNet-SSD configuration paths
PROTO_PATH = os.path.join(MODELS_DIR, "deploy.prototxt")
MODEL_PATH = os.path.join(MODELS_DIR, "mobilenet_iter_73000.caffemodel")

PROTO_URL = "https://raw.githubusercontent.com/chuanqi305/MobileNet-SSD/master/deploy.prototxt"
MODEL_URL = "https://github.com/chuanqi305/MobileNet-SSD/raw/master/mobilenet_iter_73000.caffemodel"

# Cooldown to avoid alert spamming (maps (camera_id, face_id_or_unknown) -> timestamp)
alert_cooldowns = {}
COOLDOWN_SECONDS = 30.0

# Thread trackers
camera_threads = {}
running_cameras = {}
db_lock = threading.Lock()

# ----------------- Helper Functions -----------------

def download_models():
    """Download MobileNet-SSD models if they do not exist."""
    if not os.path.exists(PROTO_PATH):
        print(f"Downloading prototxt file from: {PROTO_URL}")
        r = requests.get(PROTO_URL, timeout=30)
        with open(PROTO_PATH, "wb") as f:
            f.write(r.content)
            
    if not os.path.exists(MODEL_PATH):
        print(f"Downloading caffemodel file (~22MB) from: {MODEL_URL}...")
        r = requests.get(MODEL_URL, stream=True, timeout=60)
        with open(MODEL_PATH, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        print("Models downloaded successfully.")

def get_db_connection():
    """Open a SQLite database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def post_alert(camera_id, face_id=None, confidence=0.0, snapshot_path=None, people_count=None):
    """Post an event notification webhook back to the Node API."""
    url = f"{BACKEND_URL}/api/detections/alert"
    headers = {
        "x-api-key": API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "camera_id": camera_id,
        "face_id": face_id,
        "confidence": float(confidence),
        "snapshot_path": snapshot_path,
        "people_count": people_count
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=5)
        if response.status_code != 200:
            print(f"Failed to post alert. API returned: {response.status_code}")
    except Exception as e:
        print(f"Error posting alert webhook to backend: {e}")

# ----------------- Face Training / Encoding -----------------

def background_face_encoder():
    """Periodically check database for new faces and compute embeddings."""
    print("Background face encoding worker started...")
    while True:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Query for profiles lacking embeddings
            cursor.execute("SELECT id, name, image_path FROM faces WHERE embedding IS NULL")
            unprocessed_faces = cursor.fetchall()
            
            # Get DB directory to resolve uploaded images
            db_dir = os.path.dirname(DB_PATH)
            
            for face in unprocessed_faces:
                face_id = face["id"]
                name = face["name"]
                img_name = face["image_path"]
                
                # Resolve full image path
                img_path = os.path.join(db_dir, "uploads", "faces", img_name)
                print(f"Generating embedding for {name} ({img_name})...")
                
                if not os.path.exists(img_path):
                    print(f"Image not found at {img_path}, skipping.")
                    continue
                
                try:
                    # Run face_recognition
                    image = face_recognition.load_image_file(img_path)
                    encodings = face_recognition.face_encodings(image)
                    
                    if len(encodings) > 0:
                        # Save first encoding as JSON array string
                        encoding_list = encodings[0].tolist()
                        encoding_json = json.dumps(encoding_list)
                        
                        with db_lock:
                            cursor.execute("UPDATE faces SET embedding = ? WHERE id = ?", (encoding_json, face_id))
                            conn.commit()
                        print(f"Successfully trained face profile: {name} (ID: {face_id})")
                    else:
                        print(f"No face detected in reference photo for: {name}")
                except Exception as e:
                    print(f"Failed to encode reference photo for face {name}: {e}")
            
            conn.close()
        except Exception as e:
            print(f"Error in face encoding worker loop: {e}")
            
        time.sleep(5)

# ----------------- Camera RTSP Analyzer Thread -----------------

def analyze_camera_stream(camera_id, name, rtsp_url):
    """Worker thread analyzing a single camera stream."""
    print(f"Started analyzer thread for camera [{camera_id}] {name}")
    
    # Load MobileNet SSD network in this thread
    net = cv2.dnn.readNetFromCaffe(PROTO_PATH, MODEL_PATH)
    
    cap = cv2.VideoCapture(rtsp_url)
    if not cap.isOpened():
        print(f"Failed to open video stream for camera [{camera_id}] {name} on {rtsp_url}")
        running_cameras[camera_id] = False
        return
        
    last_analysis_time = 0.0
    last_logged_people_count = -1
    
    while running_cameras.get(camera_id, False):
        try:
            # We want to read the most recent frame. In RTSP, reading sequentially causes lag,
            # so we skip frames until we get to the current time, or read at interval.
            ret, frame = cap.read()
            if not ret:
                print(f"Lost stream for camera [{camera_id}] {name}. Reconnecting...")
                cap.release()
                time.sleep(5)
                cap = cv2.VideoCapture(rtsp_url)
                continue
                
            current_time = time.time()
            if current_time - last_analysis_time < DETECT_INTERVAL:
                continue
                
            last_analysis_time = current_time
            
            # --- 1. People Counting via MobileNet-SSD ---
            h, w = frame.shape[:2]
            # Preprocess frame: resize to 300x300, scale and normalize values
            blob = cv2.dnn.blobFromImage(cv2.resize(frame, (300, 300)), 0.007843, (300, 300), 127.5)
            net.setInput(blob)
            detections = net.forward()
            
            people_count = 0
            for i in range(detections.shape[2]):
                confidence = detections[0, 0, i, 2]
                if confidence > 0.5:
                    class_id = int(detections[0, 0, i, 1])
                    if class_id == 15:  # Label 15 is person in MobileNet-SSD
                        people_count += 1
                        
            # Periodically post count updates if changed
            if people_count != last_logged_people_count:
                last_logged_people_count = people_count
                # Log count database event
                post_alert(camera_id=camera_id, people_count=people_count)
                print(f"Camera [{camera_id}] {name} - People Count: {people_count}")
                
            # --- 2. Face Recognition ---
            # dlib works on RGB images, OpenCV captures in BGR, so convert
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Find face locations
            face_locations = face_recognition.face_locations(rgb_frame)
            
            if len(face_locations) > 0:
                print(f"Detected {len(face_locations)} face(s) in camera [{camera_id}] {name}")
                face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
                
                # Fetch currently trained known faces from database
                known_face_ids = []
                known_face_names = []
                known_face_encodings = []
                
                try:
                    conn = get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute("SELECT id, name, embedding FROM faces WHERE embedding IS NOT NULL")
                    rows = cursor.fetchall()
                    for row in rows:
                        known_face_ids.append(row["id"])
                        known_face_names.append(row["name"])
                        known_face_encodings.append(np.array(json.loads(row["embedding"])))
                    conn.close()
                except Exception as db_err:
                    print(f"Error fetching known faces from database: {db_err}")
                
                for face_encoding, face_location in zip(face_encodings, face_locations):
                    face_id = None
                    person_name = "Unknown"
                    match_confidence = 0.0
                    
                    if len(known_face_encodings) > 0:
                        # Compare face with all registered embeddings
                        matches = face_recognition.compare_faces(known_face_encodings, face_encoding, tolerance=FACE_MATCH_THRESHOLD)
                        face_distances = face_recognition.face_distance(known_face_encodings, face_encoding)
                        
                        best_match_idx = np.argmin(face_distances)
                        if matches[best_match_idx]:
                            face_id = known_face_ids[best_match_idx]
                            person_name = known_face_names[best_match_idx]
                            # Confidence derived from distance (smaller distance = higher confidence)
                            match_confidence = float(1.0 - face_distances[best_match_idx])
                            
                    # Trigger alert if not on cooldown
                    cooldown_key = (camera_id, face_id)
                    last_alert_time = alert_cooldowns.get(cooldown_key, 0.0)
                    
                    if current_time - last_alert_time >= COOLDOWN_SECONDS:
                        alert_cooldowns[cooldown_key] = current_time
                        
                        # Generate snapshot filename
                        timestamp_str = datetime.now().strftime("%Y%m%d-%H%M%S")
                        snapshot_name = f"cam-{camera_id}_{person_name.replace(' ', '_')}_{timestamp_str}.jpg"
                        snapshot_full_path = os.path.join(SNAPSHOTS_PATH, snapshot_name)
                        
                        # Save visual snapshot (including a rectangle bounding box)
                        annotated_frame = frame.copy()
                        top, right, bottom, left = face_location
                        # Draw rectangle on face
                        cv2.rectangle(annotated_frame, (left, top), (right, bottom), (0, 0, 255) if face_id is None else (0, 255, 0), 2)
                        # Add label
                        cv2.putText(annotated_frame, f"{person_name} ({match_confidence:.2f})", (left, top - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
                        
                        cv2.imwrite(snapshot_full_path, annotated_frame)
                        print(f"Logged detection alert: {person_name} at Camera [{camera_id}] {name}")
                        
                        # Trigger webhook alert
                        post_alert(
                            camera_id=camera_id,
                            face_id=face_id,
                            confidence=match_confidence if face_id else 0.5,
                            snapshot_path=snapshot_name,
                            people_count=people_count
                        )
                        
        except Exception as err:
            print(f"Error in stream analysis for camera [{camera_id}] {name}: {err}")
            time.sleep(2)
            
    cap.release()
    print(f"Terminated stream analyzer for camera [{camera_id}] {name}")

# ----------------- Orchestration / Registry Loop -----------------

def monitor_cameras():
    """Periodically check SQLite for camera updates and start/stop analyzer threads."""
    print("Main camera orchestrator loop active...")
    while True:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT id, name, rtsp_url, enabled FROM cameras")
            cameras = cursor.fetchall()
            conn.close()
            
            active_ids = set()
            
            for camera in cameras:
                cam_id = camera["id"]
                name = camera["name"]
                rtsp_url = camera["rtsp_url"]
                enabled = camera["enabled"]
                
                if enabled == 1:
                    active_ids.add(cam_id)
                    # Start thread if not currently active
                    if cam_id not in camera_threads or not camera_threads[cam_id].is_alive():
                        running_cameras[cam_id] = True
                        t = threading.Thread(
                            target=analyze_camera_stream,
                            args=(cam_id, name, rtsp_url),
                            name=f"Camera-{cam_id}"
                        )
                        t.daemon = True
                        camera_threads[cam_id] = t
                        t.start()
                else:
                    # Stop thread if camera disabled
                    if cam_id in running_cameras and running_cameras[cam_id]:
                        print(f"Stopping analyzer for disabled camera: {name}")
                        running_cameras[cam_id] = False
            
            # Stop threads for deleted cameras
            for cam_id in list(camera_threads.keys()):
                if cam_id not in active_ids:
                    print(f"Stopping analyzer for deleted camera ID: {cam_id}")
                    running_cameras[cam_id] = False
                    
        except Exception as e:
            print(f"Error in camera orchestrator loop: {e}")
            
        time.sleep(10)

# ----------------- Main Entry Point -----------------

if __name__ == "__main__":
    print("==================================================")
    print(" Starting Streamify AI Analytics Service          ")
    print("==================================================")
    print(f"DB Path        : {DB_PATH}")
    print(f"Snapshots Path : {SNAPSHOTS_PATH}")
    print(f"Backend URL    : {BACKEND_URL}")
    print("==================================================")
    
    # Download models on startup if missing
    try:
        download_models()
    except Exception as me:
        print(f"Warning: Failed to verify or download detection models: {me}")
        print("Please check your network settings.")
        
    # Start the training encoder thread
    train_thread = threading.Thread(target=background_face_encoder, name="FaceEncoder")
    train_thread.daemon = True
    train_thread.start()
    
    # Start orchestrator monitor (main thread)
    monitor_cameras()
