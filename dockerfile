
FROM node:20

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose port 8080 to allow external connections
EXPOSE 8080

# Set the environment variable for production (optional)
ENV NODE_ENV=production

# Run the app
CMD ["npm", "run", "start"]
