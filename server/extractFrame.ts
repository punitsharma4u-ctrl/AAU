import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

// Pulls one representative frame from a video buffer (currently: 1 second
// in, to skip any black/blank opening frame) and returns it as a JPEG
// buffer, ready to send to a vision model. Writes to a temp file because
// ffmpeg needs a real file path to read from -- cleans up after itself
// either way.
export async function extractFrame(videoBuffer: Buffer, originalName: string): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const ext = path.extname(originalName) || ".mp4";
  const inputPath = path.join(tmpDir, `frame-extract-in-${Date.now()}${ext}`);
  const outputPath = path.join(tmpDir, `frame-extract-out-${Date.now()}.jpg`);

  fs.writeFileSync(inputPath, videoBuffer);

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: ["1"],
          filename: path.basename(outputPath),
          folder: tmpDir,
          size: "640x?",
        })
        .on("end", () => resolve())
        .on("error", (err) => reject(err));
    });

    return fs.readFileSync(outputPath);
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}
