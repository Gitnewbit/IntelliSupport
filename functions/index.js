const functions = require("firebase-functions");
const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({
  apiKey: "YOUR_CLAUDE_API_KEY",
});

exports.askClaude = functions.https.onRequest(async (req, res) => {
  try {
    const { prompt } = req.body;

    const msg = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 500,
      messages: [
        { role: "user", content: prompt }
      ],
    });

    res.json({ reply: msg.content[0].text });

  } catch (err) {
    res.status(500).send(err.message);
  }
});