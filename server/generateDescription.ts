import { GoogleGenAI } from "@google/genai";

// Generates a factual, grounded description of a civic issue from a single
// video frame -- this replaces relying on the citizen to type a
// description, which most people won't bother doing. The prompt is
// deliberately narrow: describe only what's visible, no severity claims,
// no assumed duration, no invented specifics -- a vision model asked to
// write a "complaint" too loosely will confabulate detail that wasn't
// actually in the frame, which is worse than a plain description for
// something that becomes part of an official complaint record.
//
// Uses Gemini's free tier (gemini-2.5-flash via Google AI Studio) rather
// than a paid API -- genuinely free at this app's expected volume (1,500
// requests/day, no card required). Trade-off, by explicit choice: Google
// may use free-tier prompts to improve their models, unlike a paid tier.
// Worth revisiting if that data-usage policy becomes a concern later.
export async function generateDescriptionFromFrame(
  frameJpeg: Buffer,
  category: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured on the server");
  }

  const ai = new GoogleGenAI({ apiKey });
  const base64Image = frameJpeg.toString("base64");

  const prompt = [
    `This is a frame from a citizen-submitted video reporting a "${category}" civic issue in Delhi NCR.`,
    `Write a single factual sentence describing only what is visibly present in the image -- no assumptions`,
    `about how long the issue has existed, its severity, or its cause unless directly visible. This will be`,
    `used as the description in a formal complaint to a municipal authority, so it must stay strictly`,
    `grounded in what the image actually shows. If the image doesn't clearly show a civic issue matching`,
    `the category, say so plainly instead of inventing detail.`,
  ].join(" ");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { inlineData: { mimeType: "image/jpeg", data: base64Image } },
      { text: prompt },
    ],
  });

  return (response.text ?? "").trim();
}

