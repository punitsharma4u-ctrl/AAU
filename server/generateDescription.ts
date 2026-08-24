import Anthropic from "@anthropic-ai/sdk";

// Generates a factual, grounded description of a civic issue from a single
// video frame -- this replaces relying on the citizen to type a
// description, which most people won't bother doing. The prompt is
// deliberately narrow: describe only what's visible, no severity claims,
// no assumed duration, no invented specifics -- a vision model asked to
// write a "complaint" too loosely will confabulate detail that wasn't
// actually in the frame, which is worse than a plain description for
// something that becomes part of an official complaint record.
export async function generateDescriptionFromFrame(
  frameJpeg: Buffer,
  category: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured on the server");
  }

  const client = new Anthropic({ apiKey });
  const base64Image = frameJpeg.toString("base64");

  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 150,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: base64Image },
          },
          {
            type: "text",
            text: [
              `This is a frame from a citizen-submitted video reporting a "${category}" civic issue in Delhi NCR.`,
              `Write a single factual sentence describing only what is visibly present in the image -- no assumptions`,
              `about how long the issue has existed, its severity, or its cause unless directly visible. This will be`,
              `used as the description in a formal complaint to a municipal authority, so it must stay strictly`,
              `grounded in what the image actually shows. If the image doesn't clearly show a civic issue matching`,
              `the category, say so plainly instead of inventing detail.`,
            ].join(" "),
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text.trim() : "";
}
