/**
 * Vercel Serverless Function to serve configuration to the frontend.
 * This allows using Vercel Environment Variables without exposing them in the static build.
 */
module.exports = (req, res) => {
    res.status(200).json({
        DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || null
    });
};
