# Orca — AI-Powered Meeting Transcriptor

An AI-powered meeting recorder with **automatic speaker detection**, **emotion-colored transcripts**, and **intelligent summaries**.

## Features

- 🎙️ **Live Transcription** — Real-time speech-to-text using Deepgram or Web Speech API
- 🗣️ **Auto Speaker Detection** — Detects speaker changes via Deepgram diarization
- 🎨 **Emotion-Colored Text** — Transcript entries are colored based on detected tone
- 🤖 **AI Summary** — Dual-mode AI: instant local summarization (no API needed) or optional Gemini API
- 📊 **Session Stats** — Word count, entry count, speaker count, duration
- 📤 **Export** — Download as TXT, JSON, Markdown, WebM audio, or MP3

## Quick Start
1. Open `index.html` in your browser.
2. (Optional) Provide a Google Gemini API key for advanced AI, or skip to use Local AI.
3. Select your microphone and click **Start Recording**.
4. To enable accurate speaker diarization, provide a Deepgram API Key when prompted.

## API Setup (Deepgram)
For the best experience (including voice diarization and fast transcription across all browsers), Orca uses Deepgram. 
You must provide a Deepgram API Key. When you load the app, it will prompt you for the key, which is saved locally. Get a free key at [deepgram.com](https://deepgram.com).

## Browser Support
Works in all modern browsers when using Deepgram. Web Speech API fallback is available for Chrome/Edge.

## Browser Support

Chrome 33+ or Edge 79+ (required for Web Speech API).
