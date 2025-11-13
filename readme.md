
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
   ```
   Replace the placeholders with your actual AWS credentials.

## Usage

To start the application, run:
```
npm run dev
```

If all is well, you should be able to open your browser and navigate to `http://localhost:8080`.



