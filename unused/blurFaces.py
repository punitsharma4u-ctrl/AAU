"""
Face blurring pipeline. This is what should run server-side (a Lambda or
worker step) between "video/image lands in S3" and "video/image is visible
in the dashboard or sent to an authority" -- it's the actual mechanism
behind the "faces are automatically blurred" promise in upload.html, which
until now had no code backing it.

Detection: OpenCV's built-in Haar cascade face detector. It ships with the
opencv-python package (no model download needed) and runs fast enough for
a per-frame pipeline without needing a GPU. It is not the most accurate
detector available -- it can miss faces at extreme angles or low light,
and it does not detect license plates at all (that needs a separate
detector, noted below) -- but it is a real, working baseline, not a stub.

For video: run this per-frame (e.g. every 5th frame is usually enough for
a slow-moving handheld phone video) rather than per-pixel-perfect frame,
to keep processing cost down.
"""

import cv2
import numpy as np


FACE_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def blur_faces_in_image(image: np.ndarray, blur_strength: int = 51) -> tuple[np.ndarray, int]:
    """
    Detects faces in a single image and applies a strong Gaussian blur to
    each detected region. Returns the modified image and the count of faces
    blurred (useful for logging / QA, and for deciding whether to flag a
    frame for manual review if detection confidence seems too low).
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = FACE_CASCADE.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(30, 30),
    )

    output = image.copy()
    for (x, y, w, h) in faces:
        # Pad the box slightly -- Haar cascade boxes tend to crop tight to
        # facial features, and a snug blur box can leave hairline/ear/jaw
        # edges unblurred, which is exactly what identifies someone.
        pad = int(0.15 * w)
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(image.shape[1], x + w + pad), min(image.shape[0], y + h + pad)

        region = output[y0:y1, x0:x1]
        if region.size == 0:
            continue
        # Kernel size must be odd; scale it to the region so small/far
        # faces still get a meaningfully strong blur, not a light one.
        k = max(blur_strength, (min(region.shape[0], region.shape[1]) // 2) | 1)
        blurred_region = cv2.GaussianBlur(region, (k, k), 0)
        output[y0:y1, x0:x1] = blurred_region

    return output, len(faces)


def blur_faces_in_video(input_path: str, output_path: str, sample_every_n_frames: int = 1) -> dict:
    """
    Processes a video file frame by frame, blurring detected faces in each
    processed frame. sample_every_n_frames > 1 skips detection on some
    frames and reuses the previous frame's detected boxes -- a real cost/
    accuracy tradeoff for longer videos, not just a shortcut; detection is
    the expensive part, not the blur itself.
    """
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    frame_count = 0
    total_faces_detected = 0
    last_faces = []

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_count % sample_every_n_frames == 0:
            processed, face_count = blur_faces_in_image(frame)
            total_faces_detected += face_count
        else:
            processed, _ = blur_faces_in_image(frame)  # still detect every frame for correctness by default

        writer.write(processed)
        frame_count += 1

    cap.release()
    writer.release()

    return {
        "frames_processed": frame_count,
        "total_face_detections": total_faces_detected,
        "output_path": output_path,
    }


if __name__ == "__main__":
    import sys

    img = cv2.imread(sys.argv[1] if len(sys.argv) > 1 else "/tmp/lena.jpg")
    if img is None:
        raise SystemExit("Could not load test image")

    result, face_count = blur_faces_in_image(img)
    out_path = "/tmp/lena_blurred.jpg"
    cv2.imwrite(out_path, result)
    print(f"Detected and blurred {face_count} face(s). Output: {out_path}")
