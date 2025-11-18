
# Speech-to-Subtitles App

## Overview
This simple application allows you to listen to speech and generate real-time subtitles. The code is built 90% by ChatGPT o1-preview as an experiment in creation of apps by an LLM, the AI slop is a deliberate experiment. Read more here:
https://medium.com/@borohhov/genai-built-my-real-time-subtitles-app-faster-than-i-wrote-this-article-046e7ad1ce48

## Prerequisites
- An AWS account with appropriate permissions
- An OpenAI API key
- Node.js installed on your machine

## Setup

1. Clone this repository:
   ```
   git clone <repository-url>
   cd <repository-name>
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following content:
   ```
   AWS_ACCESS_KEY_ID=<your-access-key-id>
   AWS_SECRET_ACCESS_KEY=<your-secret-access-key>
   AWS_REGION=<your-region>
   OPENAI_API_KEY=<your-openai-api-key>
   POSTHOG_KEY=<posthog-public-key>
   POSTHOG_HOST=<posthog-host>
   ```
   Replace the placeholders with your actual AWS/OpenAI/PostHog credentials.

## Analytics & Error Tracking

The backend proxies PostHog for the browser (`/posthog`) and emits structured telemetry for most stream lifecycle events. Each OpenAI translation now also generates a PostHog AI analytics event (`$ai_generation`) that includes the request/response messages, token counts, latency, and estimated USD cost so you can track LLM spend in PostHog. Remove the PostHog environment variables if you want to disable all analytics entirely—the helpers no-op when the keys are missing.

## Usage

To start the application, run:
```
npm run dev
```

If all is well, you should be able to open your browser and navigate to `http://localhost:8080`.
