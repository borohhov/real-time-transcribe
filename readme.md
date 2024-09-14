
# Speech-to-Subtitles App

## Overview
This simple application allows you to listen to speech and generate real-time subtitles.

## Prerequisites
- An AWS account with appropriate permissions
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
   ```
   Replace the placeholders with your actual AWS credentials.

## Usage

To start the application, run:
```
node server.js
```

If all is well, you should be able to open your browser and navigate to `http://localhost:3000`.



